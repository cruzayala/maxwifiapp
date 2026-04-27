import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ExportService {

  exportCSV(data: any[], filename: string, columns: { key: string; label: string; transform?: (val: any, row: any) => string }[]) {
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }
}
