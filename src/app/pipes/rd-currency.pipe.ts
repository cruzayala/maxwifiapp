import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'rd',
  standalone: true
})
export class RdCurrencyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, showSymbol = true): string {
    if (value === null || value === undefined || value === '') return showSymbol ? 'RD$ 0.00' : '0.00';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return showSymbol ? 'RD$ 0.00' : '0.00';

    const formatted = num.toLocaleString('es-DO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return showSymbol ? `RD$ ${formatted}` : formatted;
  }
}
