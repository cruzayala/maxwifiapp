import { Injectable } from '@angular/core';

export interface ExportColumn {
  key: string;
  label: string;
  transform?: (val: any, row: any) => string | number;
}

@Injectable({ providedIn: 'root' })
export class ExportService {

  exportCSV(data: any[], filename: string, columns: ExportColumn[]) {
    const header = columns.map(c => c.label).join(',');
    const rows = data.map(row =>
      columns.map(col => {
        let val = this.getNestedValue(row, col.key);
        if (col.transform) val = col.transform(val, row);
        val = String(val ?? '').replace(/"/g, '""');
        return `"${val}"`;
      }).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    this.download(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  exportExcel(data: any[], filename: string, columns: ExportColumn[]) {
    const header = columns.map((column) => `<th>${this.escape(column.label)}</th>`).join('');
    const rows = data.map((row) => `<tr>${columns.map((column) => {
      let value = this.getNestedValue(row, column.key);
      if (column.transform) value = column.transform(value, row);
      const numeric = typeof value === 'number' && Number.isFinite(value);
      return `<td${numeric ? ' style="mso-number-format:\'0.00\'"' : ''}>${this.escape(value)}</td>`;
    }).join('')}</tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    this.download(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.xls`);
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  private download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
