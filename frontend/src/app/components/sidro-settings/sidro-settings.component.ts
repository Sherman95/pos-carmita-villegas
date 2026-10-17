import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SidroAdminService } from '../../services/sidro-admin.service';
import { ClientsService, Client } from '../../services/clients.service';
import { EmployeeService, Employee } from '../../services/employee.service';
import { ItemsService } from '../../services/items.service';
import { Item } from '../../interfaces/interfaces';
import Swal from 'sweetalert2';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

@Component({
  selector: 'app-sidro-settings',
  standalone: true,
  imports: [CommonModule, MatTabsModule, MatTableModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, FormsModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatAutocompleteModule],
  templateUrl: './sidro-settings.component.html',
  styleUrls: ['./sidro-settings.component.scss'],
  styles: [`
    .settings-container { padding: 20px; }
    table { width: 100%; margin-top: 20px; }
    .action-btn { margin-right: 8px; }
    .services-settings-panel { padding: 24px; }
    .services-intro { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; padding: 18px; border: 1px solid var(--ui-border); border-radius: 16px; background: var(--brand-soft); }
    .services-intro h3, .services-intro p { margin: 0; }
    .services-intro h3 { color: var(--brand-dark); font-weight: 800; }
    .services-intro p { margin-top: 4px; color: var(--ui-text-muted); font-size: .86rem; }
    .services-intro-icon, .service-setting-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--brand-base); }
    .services-intro-icon { width: 46px; height: 46px; border-radius: 13px; background: white; }
    .service-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .service-setting-card { width: 100%; min-height: 72px; padding: 10px 14px !important; border-radius: 14px !important; text-align: left; }
    .service-setting-card ::ng-deep .mdc-button__label { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
    .service-setting-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--brand-soft); }
    .service-setting-copy { flex: 1; min-width: 0; }
    .service-setting-copy strong, .service-setting-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .service-setting-copy strong { color: var(--brand-text); font-size: .9rem; }
    .service-setting-copy small { margin-top: 3px; color: var(--ui-text-muted); font-size: .72rem; }
    .service-setting-arrow { color: var(--brand-accent); }
    ::ng-deep .sidro-service-form { display: grid; gap: 12px; margin-top: 8px; text-align: left; }
    ::ng-deep .sidro-service-form > label:not(.sidro-publish-option) { display: grid; gap: 5px; color: #4b1e3a; font-size: .78rem; font-weight: 700; }
    ::ng-deep .sidro-service-form .swal2-input { width: 100%; height: 44px; margin: 0; border-radius: 10px; font-size: .9rem; }
    ::ng-deep .sidro-publish-option, ::ng-deep .sidro-professional-option { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    ::ng-deep .sidro-publish-option { padding: 12px; border-radius: 11px; background: #f9f1f5; color: #4b1e3a; font-weight: 700; }
    ::ng-deep .sidro-professionals-fieldset { display: grid; gap: 9px; margin: 0; padding: 13px; border: 1px solid #e2e6eb; border-radius: 11px; }
    ::ng-deep .sidro-professionals-fieldset legend { padding: 0 5px; color: #697386; font-size: .75rem; font-weight: 700; }
    ::ng-deep .sidro-schedule-help { margin: -4px 0 16px; color: #697386; font-size: .82rem; }
    ::ng-deep .sidro-schedule-editor { display: grid; gap: 8px; text-align: left; }
    ::ng-deep .sidro-schedule-row { display: grid; grid-template-columns: minmax(120px, 1fr) 120px 120px; align-items: center; gap: 12px; padding: 11px 12px; border: 1px solid #e2e6eb; border-radius: 12px; background: #fcfbfc; }
    ::ng-deep .sidro-day-toggle { display: flex; align-items: center; gap: 9px; color: #4b1e3a; font-weight: 750; cursor: pointer; }
    ::ng-deep .sidro-schedule-row > label:not(.sidro-day-toggle) { display: grid; gap: 3px; color: #697386; font-size: .65rem; font-weight: 700; text-transform: uppercase; }
    ::ng-deep .sidro-schedule-row input[type='time'] { min-width: 0; height: 38px; padding: 0 8px; border: 1px solid #cbd3dc; border-radius: 9px; background: white; color: #211923; font: inherit; }
    ::ng-deep .sidro-schedule-row input[type='time']:disabled { background: #eef0f3; color: #9aa1ad; }
    @media (max-width: 600px) { ::ng-deep .sidro-schedule-row { grid-template-columns: 1fr 1fr; } ::ng-deep .sidro-day-toggle { grid-column: 1 / -1; } }
    @media (max-width: 720px) { .settings-container { padding: 12px; } .services-settings-panel { padding: 16px 4px; } .service-settings-grid { grid-template-columns: 1fr; } }
  `]
})
export class SidroSettingsComponent implements OnInit {
  accounts: any[] = [];
  accountCols = ['nombre_completo', 'telefono', 'client_nombre', 'actions'];

  accountQuery = '';
  serviceQuery = '';
  employeeQuery = '';
  accountFilter: 'all' | 'linked' | 'pending' = 'all';
  accountsLoading = true;
  servicesLoading = true;
  employeesLoading = true;
  accountsError = '';
  servicesError = '';
  employeesError = '';

  clients: Client[] = [];
  employees: Employee[] = [];
  services: Item[] = [];

  constructor(
    private sidroService: SidroAdminService,
    private clientsService: ClientsService,
    private employeeService: EmployeeService,
    private itemsService: ItemsService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadAccounts();
    this.loadClients();
  }

  loadAccounts() {
    this.accountsLoading = true;
    this.accountsError = '';
    this.sidroService.getAccounts().subscribe({
      next: (data: any) => {
        this.accounts = data;
        this.accountsLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (e: any) => {
        this.accountsLoading = false;
        this.accountsError = e.error?.error || 'No se pudieron cargar las cuentas SIDRO.';
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  loadClients() {
    this.clientsService.getClients().subscribe(clients => {
      this.clients = clients;
      this.changeDetectorRef.detectChanges();
    });
    this.employeesLoading = true;
    this.employeesError = '';
    this.employeeService.getEmployees().subscribe({
      next: e => {
        this.employees = e;
        this.employeesLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.employeesLoading = false;
        this.employeesError = 'No se pudieron cargar las profesionales.';
        this.changeDetectorRef.detectChanges();
      }
    });
    this.servicesLoading = true;
    this.servicesError = '';
    this.itemsService.getItems().subscribe({
      next: s => {
        this.services = s.filter(i => i.tipo === 'SERVICIO');
        this.servicesLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.servicesLoading = false;
        this.servicesError = 'No se pudo cargar el catálogo de servicios.';
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  refreshAll(): void {
    this.loadAccounts();
    this.loadClients();
  }

  get linkedAccountsCount(): number {
    return this.accounts.filter(account => Boolean(account.client_nombre)).length;
  }

  get pendingAccountsCount(): number {
    return this.accounts.length - this.linkedAccountsCount;
  }

  get publishedServicesCount(): number {
    return this.services.filter(service => this.isServiceReservable(service)).length;
  }

  get activeEmployeesCount(): number {
    return this.employees.filter(employee => employee.active !== false).length;
  }

  get filteredAccounts(): any[] {
    const term = this.normalizeSearch(this.accountQuery);
    return this.accounts.filter(account => {
      const matchesStatus = this.accountFilter === 'all'
        || (this.accountFilter === 'linked' && Boolean(account.client_nombre))
        || (this.accountFilter === 'pending' && !account.client_nombre);
      const searchable = this.normalizeSearch(`${account.nombre_completo || ''} ${account.telefono || ''} ${account.client_nombre || ''}`);
      return matchesStatus && (!term || searchable.includes(term));
    });
  }

  get filteredServices(): Item[] {
    const term = this.normalizeSearch(this.serviceQuery);
    return this.services.filter(service => !term || this.normalizeSearch(service.nombre).includes(term));
  }

  get filteredEmployees(): Employee[] {
    const term = this.normalizeSearch(this.employeeQuery);
    return this.employees.filter(employee => !term || this.normalizeSearch(`${employee.nombre} ${employee.telefono || ''}`).includes(term));
  }

  setAccountFilter(filter: 'all' | 'linked' | 'pending'): void {
    this.accountFilter = filter;
  }

  isServiceReservable(service: Item): boolean {
    return service.is_reservable !== false;
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  async linkAccount(sidro_account: any) {
    const clientOptions = [...this.clients]
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map(client => ({
        id: client.id,
        nombre: client.nombre,
        telefono: client.telefono || 'Sin teléfono'
      }));
    let selectedClientId: string | null = null;

    const { value: clientId } = await Swal.fire({
      title: 'Vincular cuenta',
      html: `
        <div class="sidro-link-dialog">
          <span class="sidro-link-icon"><span class="material-icons">link</span></span>
          <p>Selecciona la clienta del POS que corresponde a <strong>${this.escapeHtml(sidro_account.nombre_completo)}</strong>.</p>
        </div>
        <label class="sidro-search-label" for="sidro-client-query">Buscar en clientes del POS</label>
        <div class="sidro-client-search-box">
          <span class="material-icons">search</span>
          <input id="sidro-client-query" type="search" placeholder="Escribe nombre o teléfono..." autocomplete="off">
        </div>
        <div id="sidro-client-results" class="sidro-client-results" role="listbox" aria-label="Resultados de clientes"></div>
        <div id="sidro-client-selected" class="sidro-client-selected" aria-live="polite"></div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Vincular cuenta',
      cancelButtonText: 'Cancelar',
      width: 560,
      customClass: { popup: 'sidro-link-popup' },
      didOpen: () => {
        const input = document.getElementById('sidro-client-query') as HTMLInputElement;
        const results = document.getElementById('sidro-client-results') as HTMLDivElement;
        const selectedBox = document.getElementById('sidro-client-selected') as HTMLDivElement;
        const setConfirmEnabled = (enabled: boolean) => {
          const confirmButton = Swal.getConfirmButton();
          if (confirmButton) confirmButton.disabled = !enabled;
        };
        setConfirmEnabled(false);

        const renderResults = (query = '') => {
          const term = this.normalizeSearch(query);
          const matchingIndexes = clientOptions
            .map((client, index) => ({ client, index }))
            .filter(({ client }) => !term || this.normalizeSearch(`${client.nombre} ${client.telefono}`).includes(term));
          const visible = matchingIndexes.slice(0, 8);

          if (visible.length === 0) {
            results.innerHTML = `
              <div class="sidro-client-empty">
                <span class="material-icons">person_search</span>
                <strong>No encontramos clientas</strong>
                <small>Prueba con otro nombre o número de teléfono.</small>
              </div>`;
            return;
          }

          results.innerHTML = visible.map(({ client, index }) => `
            <button type="button" class="sidro-client-option${selectedClientId === client.id ? ' selected' : ''}" data-index="${index}" role="option">
              <span class="sidro-result-avatar">${this.escapeHtml(client.nombre.charAt(0) || '?')}</span>
              <span class="sidro-result-copy">
                <strong>${this.escapeHtml(client.nombre)}</strong>
                <small>${this.escapeHtml(client.telefono)}</small>
              </span>
              <span class="material-icons sidro-result-arrow">chevron_right</span>
            </button>
          `).join('') + (matchingIndexes.length > visible.length
            ? `<p class="sidro-result-hint">Mostrando ${visible.length} de ${matchingIndexes.length}. Escribe más para precisar.</p>`
            : '');

          results.querySelectorAll<HTMLButtonElement>('.sidro-client-option').forEach(button => {
            button.addEventListener('click', () => {
              const client = clientOptions[Number(button.dataset['index'])];
              if (!client) return;
              selectedClientId = client.id;
              input.value = client.nombre;
              selectedBox.innerHTML = `
                <span class="material-icons">check_circle</span>
                <span><small>Clienta seleccionada</small><strong>${this.escapeHtml(client.nombre)}</strong></span>`;
              selectedBox.classList.add('visible');
              Swal.resetValidationMessage();
              setConfirmEnabled(true);
              renderResults(client.nombre);
            });
          });
        };

        input.addEventListener('input', () => {
          selectedClientId = null;
          selectedBox.classList.remove('visible');
          selectedBox.innerHTML = '';
          setConfirmEnabled(false);
          renderResults(input.value);
        });
        renderResults();
        input.focus();
      },
      preConfirm: () => {
        if (!selectedClientId) {
          Swal.showValidationMessage('Busca y selecciona una clienta de los resultados.');
          return false;
        }
        return selectedClientId;
      }
    });

    if (clientId) {
      const selected = this.clients.find(c => c.id === clientId);
      if(!selected) {
         Swal.fire('Error', 'Debes seleccionar una clienta válida de la lista', 'error');
         return;
      }
      this.sidroService.linkAccount(sidro_account.id, clientId).subscribe({
        next: () => { Swal.fire('Cuenta vinculada', 'SIDRO y el historial del POS ya corresponden a la misma clienta.', 'success'); this.loadAccounts(); },
        error: (e: any) => Swal.fire('Error', e.error?.error || 'Error al vincular', 'error')
      });
    }
  }

  async configureSchedule(emp: Employee) {
    this.sidroService.getEmployeeSchedule(emp.id).subscribe(async (current) => {
       const schedules = Array.isArray(current) ? current : [];
       const days = [
         { value: 1, label: 'Lunes' },
         { value: 2, label: 'Martes' },
         { value: 3, label: 'Miércoles' },
         { value: 4, label: 'Jueves' },
         { value: 5, label: 'Viernes' },
         { value: 6, label: 'Sábado' },
         { value: 0, label: 'Domingo' }
       ];
       const scheduleByDay = new Map<number, any>(
         schedules.map((schedule: any) => [Number(schedule.day_of_week), schedule])
       );
       const rows = days.map(day => {
         const schedule = scheduleByDay.get(day.value);
         const enabled = Boolean(schedule);
         return `
           <div class="sidro-schedule-row" data-day="${day.value}">
             <label class="sidro-day-toggle">
               <input id="schedule-enabled-${day.value}" type="checkbox" ${enabled ? 'checked' : ''}>
               <span>${day.label}</span>
             </label>
             <label><span>Entrada</span><input id="schedule-start-${day.value}" type="time" value="${String(schedule?.start_time || '09:00').slice(0, 5)}" ${enabled ? '' : 'disabled'}></label>
             <label><span>Salida</span><input id="schedule-end-${day.value}" type="time" value="${String(schedule?.end_time || '18:00').slice(0, 5)}" ${enabled ? '' : 'disabled'}></label>
           </div>
         `;
       }).join('');

       const { value: formSchedules } = await Swal.fire({
         title: `Horario de ${emp.nombre}`,
         html: `
           <p class="sidro-schedule-help">Activa los días que atiende y define su hora de entrada y salida.</p>
           <div class="sidro-schedule-editor">${rows}</div>
         `,
         showCancelButton: true,
         confirmButtonText: 'Guardar horario',
         cancelButtonText: 'Cancelar',
         width: 680,
         customClass: { popup: 'sidro-schedule-popup' },
         didOpen: () => {
           days.forEach(day => {
             const enabledInput = document.getElementById(`schedule-enabled-${day.value}`) as HTMLInputElement;
             const startInput = document.getElementById(`schedule-start-${day.value}`) as HTMLInputElement;
             const endInput = document.getElementById(`schedule-end-${day.value}`) as HTMLInputElement;
             enabledInput?.addEventListener('change', () => {
               startInput.disabled = !enabledInput.checked;
               endInput.disabled = !enabledInput.checked;
             });
           });
         },
         preConfirm: () => {
           const result = days.flatMap(day => {
             const enabled = (document.getElementById(`schedule-enabled-${day.value}`) as HTMLInputElement)?.checked;
             if (!enabled) return [];
             const start = (document.getElementById(`schedule-start-${day.value}`) as HTMLInputElement).value;
             const end = (document.getElementById(`schedule-end-${day.value}`) as HTMLInputElement).value;
             if (!start || !end || start >= end) {
               Swal.showValidationMessage(`Revisa el horario de ${day.label}: la salida debe ser posterior a la entrada.`);
               return null as any;
             }
             return [{ day_of_week: day.value, start_time: start, end_time: end }];
           });
           if (result.some((entry: any) => entry == null)) return false;
           if (result.length === 0) {
             Swal.showValidationMessage('Activa al menos un día de atención.');
             return false;
           }
           return result;
         }
       });

       if (formSchedules) {
         this.sidroService.setEmployeeSchedule(emp.id, { schedules: formSchedules }).subscribe({
           next: () => Swal.fire('Horario actualizado', 'La disponibilidad ya se aplicará en SIDRO.', 'success'),
           error: (e: any) => Swal.fire('Error', e.error?.error || 'No se pudo guardar el horario.', 'error')
         });
       }
    });
  }

  async configureService(svc: Item) {
    this.sidroService.getServiceConfig(svc.id).subscribe(async (current) => {
       let selectedImageFile: File | null = null;
       let removeImageRequested = false;
       let previewObjectUrl: string | null = null;
       const selectedProfessionals = new Set<string>(
         (current.professionals || []).map((professional: any) => professional.employee_id)
       );
       const professionalOptions = this.employees
         .filter(employee => employee.active !== false)
         .map((employee, index) => `
           <label class="sidro-professional-option">
             <input id="swal-prof-${index}" type="checkbox" value="${employee.id}"
               ${selectedProfessionals.has(employee.id) || selectedProfessionals.size === 0 ? 'checked' : ''}>
             <span>${this.escapeHtml(employee.nombre)}</span>
           </label>
         `).join('');

       const { value: formVals } = await Swal.fire({
         title: `Servicio: ${svc.nombre}`,
         html: `
           <div class="sidro-service-form">
             <section class="sidro-image-editor">
               <div class="sidro-image-preview${current.sidro_image_url ? ' has-image' : ''}" id="sidro-image-preview">
                 ${current.sidro_image_url
                   ? `<img id="sidro-image-preview-img" src="${this.escapeHtml(current.sidro_image_url)}" alt="Imagen actual de ${this.escapeHtml(svc.nombre)}">`
                   : `<img id="sidro-image-preview-img" alt="" hidden><span class="material-icons">add_photo_alternate</span>`}
               </div>
               <div class="sidro-image-controls">
                 <strong>Fotografía en SIDRO</strong>
                 <small>JPG, PNG o WebP · máximo 5 MB. Recomendado: formato horizontal 4:3.</small>
                 <label class="sidro-image-picker${current.image_upload_enabled ? '' : ' disabled'}">
                   <span class="material-icons">upload</span>
                   <span>${current.sidro_image_url ? 'Reemplazar imagen' : 'Elegir imagen'}</span>
                   <input id="sidro-image-file" type="file" accept="image/jpeg,image/png,image/webp" ${current.image_upload_enabled ? '' : 'disabled'}>
                 </label>
                 ${current.sidro_image_url
                   ? `<button id="sidro-remove-image" class="sidro-remove-image" type="button" ${current.image_upload_enabled ? '' : 'disabled'}><span class="material-icons">delete_outline</span> Quitar imagen</button>`
                   : ''}
                 ${current.image_upload_enabled
                   ? '<span id="sidro-image-state" class="sidro-image-state">La imagen se guardará al confirmar.</span>'
                   : '<span class="sidro-image-state warning">Configura las credenciales de Cloudinary en el backend para habilitar cargas.</span>'}
               </div>
             </section>
             <label>Precio del servicio
               <input id="swal-price" type="number" min="0" step="0.01" class="swal2-input" value="${current.precio ?? svc.precio ?? 0}">
             </label>
             <label>Duración de la cita (minutos)
               <input id="swal-duration" type="number" min="15" max="720" step="5" class="swal2-input" value="${current.duration_minutes || 60}">
             </label>
             <label>Margen adicional (minutos)
               <input id="swal-padding" type="number" min="0" max="180" step="5" class="swal2-input" value="${current.padding_minutes || 0}">
             </label>
             <label class="sidro-publish-option">
               <input id="swal-reservable" type="checkbox" ${current.is_reservable || current.duration_minutes == null ? 'checked' : ''}>
               <span>Mostrar este servicio en SIDRO</span>
             </label>
             <fieldset class="sidro-professionals-fieldset">
               <legend>Profesionales que realizan este servicio</legend>
               ${professionalOptions || '<p>No hay profesionales activas.</p>'}
             </fieldset>
           </div>
         `,
         focusConfirm: false,
         showCancelButton: true,
         confirmButtonText: 'Guardar cambios',
         cancelButtonText: 'Cancelar',
         width: 560,
         customClass: { popup: 'sidro-service-popup' },
         didOpen: () => {
           const input = document.getElementById('sidro-image-file') as HTMLInputElement | null;
           const preview = document.getElementById('sidro-image-preview') as HTMLDivElement | null;
           const previewImage = document.getElementById('sidro-image-preview-img') as HTMLImageElement | null;
           const imageState = document.getElementById('sidro-image-state') as HTMLSpanElement | null;
           const removeButton = document.getElementById('sidro-remove-image') as HTMLButtonElement | null;

           input?.addEventListener('change', () => {
             const file = input.files?.[0] || null;
             if (!file) return;
             if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
               input.value = '';
               Swal.showValidationMessage('Selecciona una imagen JPG, PNG o WebP.');
               return;
             }
             if (file.size > 5 * 1024 * 1024) {
               input.value = '';
               Swal.showValidationMessage('La imagen no puede superar 5 MB.');
               return;
             }

             Swal.resetValidationMessage();
             selectedImageFile = file;
             removeImageRequested = false;
             if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
             previewObjectUrl = URL.createObjectURL(file);
             if (previewImage && preview) {
               previewImage.src = previewObjectUrl;
               previewImage.hidden = false;
               preview.classList.add('has-image');
             }
             if (imageState) imageState.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
           });

           removeButton?.addEventListener('click', () => {
             selectedImageFile = null;
             removeImageRequested = true;
             if (input) input.value = '';
             if (previewObjectUrl) {
               URL.revokeObjectURL(previewObjectUrl);
               previewObjectUrl = null;
             }
             if (previewImage && preview) {
               previewImage.removeAttribute('src');
               previewImage.hidden = true;
               preview.classList.remove('has-image');
             }
             if (imageState) imageState.textContent = 'La imagen actual se eliminará al guardar.';
             removeButton.disabled = true;
           });
         },
         willClose: () => {
           if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
         },
         preConfirm: () => {
           const price = Number((document.getElementById('swal-price') as HTMLInputElement).value);
           const duration = Number((document.getElementById('swal-duration') as HTMLInputElement).value);
           const padding = Number((document.getElementById('swal-padding') as HTMLInputElement).value);
           const professionals = this.employees
             .filter(employee => employee.active !== false)
             .map((employee, index) => ({ employee, index }))
             .filter(({ index }) => (document.getElementById(`swal-prof-${index}`) as HTMLInputElement)?.checked)
             .map(({ employee }) => ({ employee_id: employee.id }));

           if (!Number.isFinite(price) || price < 0) {
             Swal.showValidationMessage('Ingresa un precio válido.');
             return false;
           }
           if (!Number.isFinite(duration) || duration < 15 || duration > 720) {
             Swal.showValidationMessage('La duración debe estar entre 15 y 720 minutos.');
             return false;
           }
           if (!Number.isFinite(padding) || padding < 0 || padding > 180) {
             Swal.showValidationMessage('El margen debe estar entre 0 y 180 minutos.');
             return false;
           }
           if ((document.getElementById('swal-reservable') as HTMLInputElement).checked && professionals.length === 0) {
             Swal.showValidationMessage('Selecciona al menos una profesional para publicar el servicio.');
             return false;
           }

           return {
             precio: price,
             duration_minutes: duration,
             padding_minutes: padding,
             is_reservable: (document.getElementById('swal-reservable') as HTMLInputElement).checked,
             professionals
           };
         }
       });
       if (formVals) {
          this.sidroService.updateServiceConfig(svc.id, formVals).subscribe({
             next: () => {
               svc.precio = formVals.precio;
               svc.duration_minutes = formVals.duration_minutes;
               svc.padding_minutes = formVals.padding_minutes;
               svc.is_reservable = formVals.is_reservable;
               const finish = (message: string) => {
                 this.changeDetectorRef.detectChanges();
                 Swal.fire('Servicio actualizado', message, 'success');
               };

               if (selectedImageFile) {
                 this.sidroService.uploadServiceImage(svc.id, selectedImageFile).subscribe({
                   next: (image) => {
                     svc.sidro_image_url = image.sidro_image_url;
                     svc.sidro_image_public_id = image.sidro_image_public_id;
                     finish('La configuración y la nueva fotografía ya se aplican en SIDRO.');
                   },
                   error: (error: any) => Swal.fire(
                     'Configuración guardada',
                     error.error?.error || error.message || 'La configuración se guardó, pero no se pudo cargar la imagen.',
                     'warning'
                   )
                 });
                 return;
               }

               if (removeImageRequested) {
                 this.sidroService.removeServiceImage(svc.id).subscribe({
                   next: (image) => {
                     svc.sidro_image_url = image.sidro_image_url;
                     svc.sidro_image_public_id = image.sidro_image_public_id;
                     finish('La configuración se guardó y SIDRO volverá a usar una imagen de respaldo.');
                   },
                   error: (error: any) => Swal.fire(
                     'Configuración guardada',
                     error.error?.error || error.message || 'La configuración se guardó, pero no se pudo eliminar la imagen.',
                     'warning'
                   )
                 });
                 return;
               }

               finish('El precio, tiempo y disponibilidad ya se aplican en SIDRO.');
             },
             error: (e: any) => Swal.fire('Error', e.error?.error || 'Fallo al guardar', 'error')
          });
       }
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#039;',
      '"': '&quot;'
    })[character] || character);
  }

  private normalizeSearch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
