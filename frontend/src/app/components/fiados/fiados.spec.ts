import { ComponentFixture, TestBed } from '@angular/core/testing';

// 👇 CORRECCIÓN: Importamos FiadosComponent, no Fiados
import { FiadosComponent } from './fiados';

describe('FiadosComponent', () => {
  let component: FiadosComponent;
  let fixture: ComponentFixture<FiadosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FiadosComponent] // 👇 Aquí también
    })
    .compileComponents();

    fixture = TestBed.createComponent(FiadosComponent); // 👇 Y aquí
    component = fixture.componentInstance;
    fixture.detectChanges(); // detectChanges es mejor que whenStable para inicializar
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});