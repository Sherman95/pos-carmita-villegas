import { ChangeDetectorRef, Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ClientMatch,
  SidroAdminService,
  SidroRequest,
  SidroRequestStatus
} from '../../services/sidro-admin.service';
import { AuthService } from '../../services/auth.service';
import { ClientsService, Client } from '../../services/clients.service';
import {
  buildWhatsappLink,
  buildWhatsappTemplateMessage,
  whatsappMessageTemplates
} from '../../utils/whatsapp-link';
import { validateEcuadorDocument } from '../../utils/ecuador-id';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-sidro-requests',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink
  ],
  templateUrl: './sidro-requests.component.html',
  styleUrl: './sidro-requests.component.scss'
})
export class SidroRequestsComponent implements OnInit {
  @Output() appointmentsChanged = new EventEmitter<void>();

  requests: SidroRequest[] = [];
  displayedColumns: string[] = [
    'client_name',
    'service_name',
    'employee_name',
    'date',
    'status',
    'actions'
  ];
  loading = true;
  loadError = '';
  processingId: number | null = null;
  linkingRequestId: number | null = null;
  searchTerm = '';
  statusFilter: SidroRequestStatus | 'ALL' = 'ALL';
  professionalFilter = 'ALL';
  highlightedRequestId: number | null = null;

  readonly statusOptions: Array<{ value: SidroRequestStatus | 'ALL'; label: string }> = [
    { value: 'ALL', label: 'Todos los estados' },
    { value: 'PENDIENTE', label: 'Pendientes' },
    { value: 'PROPUESTA', label: 'Propuestas' },
    { value: 'CONFIRMADA', label: 'Confirmadas' },
    { value: 'APROBADA_PENDIENTE_VINCULACION', label: 'Pendientes de vinculación' },
    { value: 'CONFLICTO_VINCULACION', label: 'Con conflicto' },
    { value: 'RECHAZADA', label: 'Rechazadas' },
    { value: 'CANCELADA', label: 'Canceladas' }
  ];

  constructor(
    private sidroService: SidroAdminService,
    private authService: AuthService,
    private clientsService: ClientsService,
    private changeDetectorRef: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const openParam = Number(this.route.snapshot.queryParamMap.get('open'));
    this.highlightedRequestId = Number.isSafeInteger(openParam) && openParam > 0 ? openParam : null;
    this.loadRequests();
  }

  get isAdmin(): boolean {
    const user = this.authService.currentUser();
    return user?.role?.trim().toLowerCase() === 'admin';
  }

  get professionals(): string[] {
    return [...new Set(this.requests.map((request) => request.employee_name).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, 'es')
    );
  }

  get filteredRequests(): SidroRequest[] {
    const term = this.searchTerm.trim().toLocaleLowerCase('es');

    return this.requests.filter((request) => {
      const matchesStatus = this.statusFilter === 'ALL' || request.status === this.statusFilter;
      const matchesProfessional =
        this.professionalFilter === 'ALL' || request.employee_name === this.professionalFilter;
      const searchableText = `${request.client_name} ${request.service_name} ${request.employee_name} ${request.client_notes || ''}`
        .toLocaleLowerCase('es');

      return matchesStatus && matchesProfessional && (!term || searchableText.includes(term));
    });
  }

  get hasLinkingPending(): boolean {
    return this.requests.some(
      (request) =>
        !request.linked_client_id &&
        ['PENDIENTE', 'APROBADA_PENDIENTE_VINCULACION', 'CONFLICTO_VINCULACION'].includes(
          request.status
        )
    );
  }

  loadRequests(): void {
    this.loading = true;
    this.loadError = '';
    this.sidroService.getRequests().subscribe({
      next: (data) => {
        this.requests = data;
        this.loading = false;
        this.revealHighlightedRequest();
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.loading = false;
        this.loadError =
          error.status === 403
            ? 'No tienes permisos o no estás vinculado a un profesional para consultar solicitudes.'
            : 'No fue posible cargar las solicitudes SIDRO. Intenta nuevamente.';
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  setStatusFilter(status: SidroRequestStatus): void {
    this.statusFilter = status;
  }

  countByStatus(status: SidroRequestStatus): number {
    return this.requests.filter((request) => request.status === status).length;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = 'ALL';
    this.professionalFilter = 'ALL';
  }

  canManage(request: SidroRequest): boolean {
    return request.status === 'PENDIENTE';
  }

  get canLink(): boolean {
    return this.authService.hasPermission('sidro_accounts.link');
  }

  canLinkRequest(request: SidroRequest): boolean {
    return (
      this.canLink &&
      !request.linked_client_id &&
      Boolean(request.sidro_account_id) &&
      ['PENDIENTE', 'APROBADA_PENDIENTE_VINCULACION', 'CONFLICTO_VINCULACION'].includes(
        request.status
      )
    );
  }

  async linkExisting(request: SidroRequest): Promise<void> {
    if (!this.canLinkRequest(request) || this.linkingRequestId !== null) return;
    const accountId = request.sidro_account_id as string;
    this.linkingRequestId = request.id;
    this.changeDetectorRef.detectChanges();
    try {
      const [clients, matchesResponse] = await Promise.all([
        firstValueFrom(this.clientsService.getClients()),
        firstValueFrom(this.sidroService.getAccountMatches(accountId))
      ]);
      const matches = matchesResponse.matches || [];
      const matchById = new Map(matches.map((match) => [match.id, match]));
      const sortedClients = [...clients].sort((a, b) => {
        const aMatch = matchById.has(a.id) ? 0 : 1;
        const bMatch = matchById.has(b.id) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return (a.nombre || '').localeCompare(b.nombre || '', 'es');
      });

      if (sortedClients.length === 0) {
        const fill = await Swal.fire({
          icon: 'info',
          title: 'No hay clientes en el POS',
          text: 'Todavía no existe ningún cliente registrado. Usa "Crear cliente nuevo y vincular".',
          showCancelButton: true,
          confirmButtonText: 'Crear cliente nuevo',
          cancelButtonText: 'Cerrar',
          confirmButtonColor: '#4b1e3a'
        });
        if (fill.isConfirmed) await this.createClientAndLink(request);
        return;
      }

      const optionsHtml = sortedClients
        .map((client) => {
          const match = matchById.get(client.id);
          const badges: string[] = [];
          if (match) {
            badges.push(
              `<span class="match-badge">Coincide por ${match.match_reasons
                .map((reason) => this.matchReasonLabel(reason))
                .join(', ')}</span>`
            );
          }
          if (match?.linked_to_other) {
            badges.push('<span class="match-badge warning">Vinculada a otra cuenta SIDRO</span>');
          }
          const secondary = [client.cedula, client.telefono].filter(Boolean).join(' · ');
          return `<button type="button" class="client-option" data-client-id="${client.id}">
            <strong>${this.escapeHtml(client.nombre || 'Sin nombre')}</strong>
            ${secondary ? `<small>${this.escapeHtml(secondary)}</small>` : ''}
            ${badges.join('')}
          </button>`;
        })
        .join('');

      let selectedClientId: string | null = null;
      const result = await Swal.fire<string>({
        title: 'Vincular con cliente existente',
        width: 620,
        html: `
          <p class="swal-hint">${
            matches.length > 0
              ? 'Encontramos posibles coincidencias. Verifica la identidad antes de confirmar.'
              : 'Selecciona la clienta del POS que corresponde a esta cuenta SIDRO.'
          }</p>
          <input id="link-client-search" class="swal2-input" type="search" placeholder="Buscar por nombre, cédula o teléfono" autocomplete="off">
          <div id="link-client-list" class="client-option-list">${optionsHtml}</div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Vincular',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#4b1e3a',
        focusConfirm: false,
        didOpen: () => {
          const search = document.getElementById('link-client-search') as HTMLInputElement | null;
          const list = document.getElementById('link-client-list');
          list?.querySelectorAll<HTMLElement>('.client-option').forEach((button) => {
            button.addEventListener('click', () => {
              list.querySelectorAll('.client-option').forEach((option) =>
                option.classList.remove('selected')
              );
              button.classList.add('selected');
              selectedClientId = button.dataset['clientId'] || null;
            });
          });
          search?.addEventListener('input', () => {
            const term = search.value.trim().toLocaleLowerCase('es');
            list?.querySelectorAll<HTMLElement>('.client-option').forEach((button) => {
              const text = button.textContent?.toLocaleLowerCase('es') || '';
              button.style.display = !term || text.includes(term) ? '' : 'none';
            });
          });
        },
        preConfirm: () => {
          if (!selectedClientId) {
            Swal.showValidationMessage('Selecciona una clienta de la lista.');
            return false;
          }
          return selectedClientId;
        }
      });

      if (result.isConfirmed && typeof result.value === 'string') {
        const selected = matchById.get(result.value);
        if (selected?.linked_to_other) {
          const reassign = await Swal.fire({
            icon: 'warning',
            title: 'Clienta vinculada a otra cuenta SIDRO',
            text: 'Si continúas, el vínculo anterior se desactivará y quedará asociada a esta cuenta.',
            showCancelButton: true,
            confirmButtonText: 'Sí, reasignar vínculo',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#b42318'
          });
          if (!reassign.isConfirmed) return;
        }
        this.saveAccountLink(request, result.value, false);
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        this.showLinkError(error);
      } else {
        Swal.fire('No se pudo abrir la vinculación', 'Intenta nuevamente.', 'error');
      }
    } finally {
      this.linkingRequestId = null;
      this.changeDetectorRef.detectChanges();
    }
  }

  async createClientAndLink(request: SidroRequest): Promise<void> {
    if (!this.canLinkRequest(request) || this.linkingRequestId !== null) return;
    const accountId = request.sidro_account_id as string;
    this.linkingRequestId = request.id;
    this.changeDetectorRef.detectChanges();
    try {
      const detail = (await firstValueFrom(this.sidroService.getAccountDetail(accountId))).account;
      const result = await Swal.fire({
        title: 'Crear cliente nuevo y vincular',
        width: 560,
        html: `
          <p class="swal-hint">Revisa y completa los datos del cliente POS. La cédula o RUC y el correo no pueden coincidir con otro cliente. Validamos el formato y el dígito verificador; la verificación oficial del RUC con el SRI se realiza por separado.</p>
          <label class="swal-field-label" for="new-client-name">Nombres y apellidos</label>
          <input id="new-client-name" class="swal2-input" type="text" maxlength="160" value="${this.escapeHtml(detail.nombre_completo || '')}">
          <label class="swal-field-label" for="new-client-doc">Cédula / RUC</label>
          <input id="new-client-doc" class="swal2-input" type="text" inputmode="numeric" maxlength="13" value="${this.escapeHtml(detail.documento || '')}">
          <label class="swal-field-label" for="new-client-phone">WhatsApp</label>
          <input id="new-client-phone" class="swal2-input" type="tel" maxlength="20" value="${this.escapeHtml(detail.telefono || '')}">
          <label class="swal-field-label" for="new-client-email">Correo electrónico</label>
          <input id="new-client-email" class="swal2-input" type="email" maxlength="160" value="${this.escapeHtml(detail.email || '')}">
          <label class="swal-field-label" for="new-client-address">Dirección</label>
          <input id="new-client-address" class="swal2-input" type="text" maxlength="200" value="${this.escapeHtml(detail.direccion || '')}">
        `,
        showCancelButton: true,
        confirmButtonText: 'Crear y vincular',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#4b1e3a',
        focusConfirm: false,
        preConfirm: () => {
          const value = (id: string) =>
            (document.getElementById(id) as HTMLInputElement | null)?.value.trim() || '';
          const nombre = value('new-client-name');
          const cedula = value('new-client-doc');
          const telefono = value('new-client-phone');
          const email = value('new-client-email');
          const direccion = value('new-client-address');

          if (nombre.length < 3) {
            Swal.showValidationMessage('Ingresa al menos 3 caracteres de nombres y apellidos.');
            return false;
          }
          const documentValidation = validateEcuadorDocument(cedula);
          if (!documentValidation.valid) {
            Swal.showValidationMessage(documentValidation.error || 'La cédula o RUC no es válido.');
            return false;
          }
          if (telefono.length < 8) {
            Swal.showValidationMessage('Ingresa un número de WhatsApp válido.');
            return false;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Swal.showValidationMessage('Ingresa un correo electrónico válido.');
            return false;
          }
          if (direccion.length < 5) {
            Swal.showValidationMessage('Ingresa una dirección de al menos 5 caracteres.');
            return false;
          }
          return { nombre, cedula, telefono, email, direccion };
        }
      });

      if (!result.isConfirmed || !result.value) return;
      this.createClientRequest(request, result.value);
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        this.showLinkError(error);
      } else {
        Swal.fire('No se pudo abrir el formulario', 'Intenta nuevamente.', 'error');
      }
    } finally {
      this.linkingRequestId = null;
      this.changeDetectorRef.detectChanges();
    }
  }

  private createClientRequest(
    request: SidroRequest,
    payload: { nombre: string; cedula: string; telefono: string; email: string; direccion: string }
  ): void {
    this.linkingRequestId = request.id;
    this.sidroService
      .createClientAndLink({ sidro_account_id: request.sidro_account_id as string, ...payload })
      .subscribe({
        next: (response) => {
          this.linkingRequestId = null;
          const confirmed = response.confirmed_requests?.length || 0;
          const conflicts = response.conflicts?.length || 0;
          const parts = [response.message || 'El cliente se creó y vinculó correctamente.'];
          if (confirmed > 0) {
            parts.push(
              `Se confirmaron ${confirmed} solicitud(es) con su cita oficial en la agenda.`
            );
          }
          if (conflicts > 0) {
            parts.push(
              `${conflicts} solicitud(es) quedaron con conflicto de horario y requieren revisión manual.`
            );
          }
          Swal.fire({
            icon: conflicts > 0 ? 'warning' : 'success',
            title: 'Cliente creado y vinculado',
            text: parts.join(' '),
            confirmButtonColor: '#4b1e3a'
          });
          this.loadRequests();
          if (confirmed > 0 || conflicts > 0) this.appointmentsChanged.emit();
        },
        error: (error: HttpErrorResponse) => {
          this.linkingRequestId = null;
          this.showLinkError(error);
          this.changeDetectorRef.detectChanges();
        }
      });
  }

  private saveAccountLink(request: SidroRequest, clientId: string, force: boolean): void {
    this.linkingRequestId = request.id;
    this.sidroService.linkAccount(request.sidro_account_id as string, clientId, force).subscribe({
      next: (response) => {
        this.linkingRequestId = null;
        const confirmed = response?.confirmed_requests?.length || 0;
        const conflicts = response?.conflicts?.length || 0;
        const parts = [
          response?.message || (force ? 'Vínculo reasignado correctamente.' : 'Vinculación completada.')
        ];
        if (confirmed > 0)
          parts.push(`Se confirmaron ${confirmed} solicitud(es) con su cita oficial en la agenda.`);
        if (conflicts > 0)
          parts.push(`${conflicts} solicitud(es) quedaron con conflicto de horario.`);
        Swal.fire({
          icon: conflicts > 0 ? 'warning' : 'success',
          title: force ? 'Vínculo reasignado' : 'Cuenta vinculada',
          text: parts.join(' '),
          confirmButtonColor: '#4b1e3a'
        });
        this.loadRequests();
        if (confirmed > 0 || conflicts > 0) this.appointmentsChanged.emit();
      },
      error: async (error: HttpErrorResponse) => {
        this.linkingRequestId = null;
        if (error.status === 409 && !force) {
          const reassign = await Swal.fire({
            icon: 'warning',
            title: 'Clienta vinculada a otra cuenta SIDRO',
            text:
              error.error?.error ||
              'Si continúas, el vínculo anterior se desactivará y quedará asociada a esta cuenta.',
            showCancelButton: true,
            confirmButtonText: 'Sí, reasignar vínculo',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#b42318'
          });
          if (reassign.isConfirmed) this.saveAccountLink(request, clientId, true);
          this.changeDetectorRef.detectChanges();
          return;
        }
        this.showLinkError(error);
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  private showLinkError(error: HttpErrorResponse): void {
    if (error.status === 409 && Array.isArray(error.error?.matches)) {
      const matches = error.error.matches as ClientMatch[];
      const listHtml = matches
        .slice(0, 5)
        .map(
          (match) =>
            `<li><strong>${this.escapeHtml(match.nombre || 'Sin nombre')}</strong> · ${this.escapeHtml(
              match.cedula || 'sin cédula'
            )} · ${match.match_reasons.map((reason) => this.matchReasonLabel(reason)).join(', ')}</li>`
        )
        .join('');
      Swal.fire({
        icon: 'warning',
        title: 'Ya existe un cliente parecido',
        html: `
          <p>${
            error.error?.error ||
            'Existe un cliente en el POS con la misma cédula o correo. Usa "Vincular con cliente existente".'
          }</p>
          <ul class="match-list">${listHtml}</ul>
        `,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#4b1e3a'
      });
      return;
    }
    if (error.status === 403) {
      Swal.fire(
        'Sin permisos',
        error.error?.error || 'No tienes permiso para vincular clientas.',
        'error'
      );
      return;
    }
    this.showActionError(error, 'completar la vinculación');
  }

  private matchReasonLabel(reason: ClientMatch['match_reasons'][number]): string {
    const labels: Record<ClientMatch['match_reasons'][number], string> = {
      documento: 'cédula/RUC',
      correo: 'correo',
      telefono: 'teléfono'
    };
    return labels[reason] || reason;
  }

  get canContactWhatsapp(): boolean {
    return this.requests.some((request) => Boolean(request.client_phone_normalized));
  }

  hasWhatsapp(request: SidroRequest): boolean {
    return Boolean(request.client_phone_normalized);
  }

  whatsappUnavailableMessage(request: SidroRequest): string {
    return this.hasWhatsapp(request)
      ? `Escribir a ${request.client_name} por WhatsApp`
      : 'La clienta no tiene WhatsApp registrado';
  }

  async openWhatsapp(request: SidroRequest): Promise<void> {
    const phone = request.client_phone_normalized;
    if (!phone) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin WhatsApp registrado',
        text: 'La clienta no tiene un número de WhatsApp válido. Puede actualizarlo desde su perfil en SIDRO.',
        confirmButtonColor: '#4b1e3a'
      });
      return;
    }

    const context = {
      clientName: request.client_name?.split(' ')[0] || '',
      serviceName: request.service_name,
      date: this.formatDate(request.request_date),
      time: this.formatTime(request.start_time)
    };
    const optionsHtml = whatsappMessageTemplates
      .map((template) => `<option value="${template.id}">${template.label}</option>`)
      .join('');
    const initialText = this.escapeHtml(
      buildWhatsappTemplateMessage(whatsappMessageTemplates[0].id, context)
    );

    const result = await Swal.fire({
      title: 'Escribir por WhatsApp',
      html: `
        <label class="swal-field-label" for="wa-template">Plantilla</label>
        <select id="wa-template" class="swal2-select">${optionsHtml}</select>
        <label class="swal-field-label" for="wa-text">Mensaje</label>
        <textarea id="wa-text" class="swal2-textarea" maxlength="500">${initialText}</textarea>
      `,
      showCancelButton: true,
      confirmButtonText: 'Abrir WhatsApp',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#25D366',
      focusConfirm: false,
      didOpen: () => {
        const select = document.getElementById('wa-template') as HTMLSelectElement | null;
        const textarea = document.getElementById('wa-text') as HTMLTextAreaElement | null;
        select?.addEventListener('change', () => {
          if (textarea) textarea.value = buildWhatsappTemplateMessage(select.value, context);
        });
      },
      preConfirm: () => {
        const textarea = document.getElementById('wa-text') as HTMLTextAreaElement | null;
        const value = textarea?.value.trim() || '';
        if (!value) {
          Swal.showValidationMessage('Escribe un mensaje antes de continuar.');
          return false;
        }
        return value;
      }
    });

    if (result.isConfirmed && typeof result.value === 'string') {
      const link = buildWhatsappLink(phone, result.value);
      if (link) window.open(link, '_blank', 'noopener');
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async accept(request: SidroRequest): Promise<void> {
    if (!this.canManage(request) || this.processingId !== null) return;

    const confirmation = await Swal.fire({
      title: '¿Aprobar solicitud?',
      text: `${request.client_name} · ${request.service_name} · ${this.formatDate(request.request_date)} ${this.formatTime(request.start_time)}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, aprobar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#4b1e3a'
    });

    if (!confirmation.isConfirmed) return;

    this.processingId = request.id;
    this.sidroService.acceptRequest(request.id).subscribe({
      next: (res) => {
        this.processingId = null;
        const pendingLink = res.status === 'APROBADA_PENDIENTE_VINCULACION';
        Swal.fire({
          icon: 'success',
          title: pendingLink ? 'Aprobada, falta vincular' : 'Solicitud aprobada',
          text: res.message,
          confirmButtonColor: '#4b1e3a'
        });
        this.loadRequests();
        this.appointmentsChanged.emit();
      },
      error: (error: HttpErrorResponse) => {
        this.processingId = null;
        this.showActionError(error, 'aprobar la solicitud');
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  async reject(request: SidroRequest): Promise<void> {
    if (!this.canManage(request) || this.processingId !== null) return;

    const confirmation = await Swal.fire({
      title: '¿Rechazar solicitud?',
      text: 'La clienta verá la solicitud como rechazada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, rechazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b42318'
    });

    if (!confirmation.isConfirmed) return;

    this.processingId = request.id;
    this.sidroService.rejectRequest(request.id).subscribe({
      next: () => {
        this.processingId = null;
        Swal.fire('Solicitud rechazada', 'El estado se actualizó correctamente.', 'success');
        this.loadRequests();
      },
      error: (error: HttpErrorResponse) => {
        this.processingId = null;
        this.showActionError(error, 'rechazar la solicitud');
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  async propose(request: SidroRequest): Promise<void> {
    if (!this.canManage(request) || this.processingId !== null) return;

    const initialDate = this.normalizeDate(request.request_date);
    const initialTime = this.formatTime(request.start_time);
    const minimumDate = this.localDateValue(new Date());
    const { value: formValues } = await Swal.fire({
      title: 'Proponer otro horario',
      html: `
        <label class="swal-field-label" for="sidro-proposed-date">Nueva fecha</label>
        <input id="sidro-proposed-date" class="swal2-input" type="date" min="${minimumDate}" value="${initialDate}">
        <label class="swal-field-label" for="sidro-proposed-time">Nueva hora</label>
        <input id="sidro-proposed-time" class="swal2-input" type="time" value="${initialTime}">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Enviar propuesta',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#4b1e3a',
      preConfirm: () => {
        const date = (document.getElementById('sidro-proposed-date') as HTMLInputElement).value;
        const time = (document.getElementById('sidro-proposed-time') as HTMLInputElement).value;
        if (!date || !time) {
          Swal.showValidationMessage('Selecciona una fecha y una hora.');
          return false;
        }
        return [date, time];
      }
    });

    if (formValues && formValues[0] && formValues[1]) {
      this.processingId = request.id;
      this.sidroService.proposeAlternative(request.id, formValues[0], formValues[1]).subscribe({
        next: () => {
          this.processingId = null;
          Swal.fire('Propuesta enviada', 'La clienta podrá aceptar o rechazar el nuevo horario.', 'success');
          this.loadRequests();
        },
        error: (error: HttpErrorResponse) => {
          this.processingId = null;
          this.showActionError(error, 'enviar la propuesta');
          this.changeDetectorRef.detectChanges();
        }
      });
    }
  }

  statusLabel(status: SidroRequestStatus): string {
    const labels: Record<SidroRequestStatus, string> = {
      PENDIENTE: 'Pendiente',
      PROPUESTA: 'Propuesta enviada',
      APROBADA_PENDIENTE_VINCULACION: 'Pendiente de vinculación',
      CONFIRMADA: 'Confirmada',
      RECHAZADA: 'Rechazada',
      CANCELADA: 'Cancelada',
      CONFLICTO_VINCULACION: 'Conflicto de vinculación'
    };
    return labels[status];
  }

  statusClass(status: SidroRequestStatus): string {
    return `status-${status.toLocaleLowerCase().replaceAll('_', '-')}`;
  }

  formatDate(value: string | null | undefined): string {
    const normalized = this.normalizeDate(value);
    const [year, month, day] = normalized.split('-').map(Number);
    if (!year || !month || !day) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-EC', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(year, month - 1, day));
  }

  formatTime(value: string | null | undefined): string {
    return value?.slice(0, 5) || '--:--';
  }

  private revealHighlightedRequest(): void {
    if (!this.highlightedRequestId) return;
    const target = this.requests.find((request) => request.id === this.highlightedRequestId);
    if (!target) return;
    this.searchTerm = '';
    this.statusFilter = 'ALL';
    this.professionalFilter = 'ALL';
    this.changeDetectorRef.detectChanges();
    setTimeout(() => {
      document
        .getElementById(`sidro-request-${this.highlightedRequestId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  private normalizeDate(value: string | null | undefined): string {
    return value?.slice(0, 10) || '';
  }

  private localDateValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private showActionError(error: HttpErrorResponse, action: string): void {
    const backendMessage = error.error?.error;
    if (error.status === 409) {
      Swal.fire(
        'Conflicto de horario',
        backendMessage || 'Ese horario ya no está disponible. Revisa la agenda o propón otro horario.',
        'warning'
      );
      return;
    }
    if (error.status === 403) {
      Swal.fire('Sin permisos', backendMessage || `No tienes permiso para ${action}.`, 'error');
      return;
    }
    Swal.fire('No se pudo completar la acción', backendMessage || `Ocurrió un error al ${action}.`, 'error');
  }
}
