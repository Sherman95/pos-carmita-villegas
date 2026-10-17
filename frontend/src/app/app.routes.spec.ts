import { routes } from './app.routes';

describe('Agenda routes', () => {
  it('expone Agenda y Solicitudes SIDRO dentro de la sección de citas', () => {
    expect(routes.find((route) => route.path === 'citas')?.data?.['view']).toBe('agenda');
    expect(routes.find((route) => route.path === 'citas/solicitudes')?.data?.['view']).toBe(
      'requests'
    );
  });

  it('conserva el acceso anterior redirigiéndolo a la pestaña integrada', () => {
    const legacyRoute = routes.find((route) => route.path === 'sidro/requests');
    expect(legacyRoute?.redirectTo).toBe('citas/solicitudes');
    expect(legacyRoute?.pathMatch).toBe('full');
  });

  it('protege la administración de usuarios y la configuración SIDRO como rutas de administrador', () => {
    const usersRoute = routes.find((route) => route.path === 'settings/users');
    const sidroSettingsRoute = routes.find((route) => route.path === 'sidro/settings');

    expect(usersRoute?.canActivate?.length).toBe(2);
    expect(sidroSettingsRoute?.canActivate?.length).toBe(2);
  });
});
