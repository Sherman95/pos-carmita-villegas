import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CartFooterComponent } from './components/cart-footer/cart-footer'; // <--- 1. IMPORTAR
import { NavigationComponent } from './components/navigation/navigation';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CartFooterComponent, NavigationComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('frontend');
}