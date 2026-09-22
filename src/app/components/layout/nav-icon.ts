import { Component, Input } from '@angular/core';
import { NAV_ICON_IMPORTS, NavIcon } from './nav';

/** Icono de una opcion del menu; compartido por el menu lateral y la barra inferior del celular. */
@Component({
  selector: 'app-nav-icon',
  standalone: true,
  imports: [...NAV_ICON_IMPORTS],
  templateUrl: './nav-icon.html',
  styles: [':host { display: inline-flex; align-items: center; justify-content: center; }'],
})
export class NavIconComponent {
  @Input({ required: true }) icon!: NavIcon;
  @Input() size = 18;
}
