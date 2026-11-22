// SPDX-License-Identifier: AGPL-3.0-or-later
// ExcelJS's self-contained build (src/main/design-export/xlsx.ts) has the package's own types.
declare module 'exceljs/dist/exceljs.min.js' {
  import ExcelJS = require('exceljs');
  export = ExcelJS;
}
