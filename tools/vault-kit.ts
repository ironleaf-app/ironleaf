// The modules the former host app's vault tools use as Ironleaf has them (8.0, 28 Oct 2026; the former host app
// native-runtime/plugins/desktop/ vault-kit.mjs): views, record views, the chart kit, module records and their types,
// areas, tags, front matter, finance and publications. tools/build-embedded.mjs builds it beside records.mjs.
export { MODULES, MODULE_TYPES, moduleById, moduleOfType, typeFolder, moduleFolder, readModuleOptions, currencyOf, SPEND_CATEGORIES } from '../src/shared/module-records';
export { moduleOn, LIFE_MODULES } from '../src/shared/life-modules';
export { readAreas, areaNamed } from '../src/shared/areas';
export { fillTemplate } from '../src/shared/dates';
export { cleanTag, removeTag } from '../src/shared/tags';
export { readProps, changeProps, frontMatterRange, asStrings } from '../src/shared/frontmatter';
export { extractTags } from '../src/shared/markdown';
export { readView, writeView, defaultView, runView, suggestDisplay, knownProps, setNoteProp, LAYOUTS, LAYOUT_WORDS, FILTER_OPS, SUMMARY_KINDS, VIEW_EXT, VIEWS_FOLDER, sourceWords, groupBoard, valueText, valueOf, summarize, summaryText, placeOnDays } from '../src/shared/views';
export { cleanRecordView, writeRecordView, readRecordView, viewFileName, RECORD_LAYOUTS, CHART_TYPES, CHART_WORDS } from '../src/shared/record-views';
export { RECORD_KINDS, KIND_WORDS } from '../src/shared/workspace-records';
export { readTable, addTableRow } from '../src/shared/layouts';
export { isFinished } from '../src/shared/finished';
export { newSpendingText, withSpendRows, readMoney, readIsoDay } from '../src/shared/finance';
export { cleanChart, readChartBlock, writeChartBlock, workChart, chartSelection, chartRows, chartPoints, mermaidOf, chartCaption, readNumber, suggestChart, CHART_KINDS, CHART_KIND_WORDS } from '../src/shared/chart-kit';
export { withDeliveryRow, readEdition } from '../src/shared/publications';
// A bill's paid and due keep to Mark paid in every free-text write, the former host app's neuralvault_save too (9.5, 2
// Nov 2026).
export { guardBillFreeText } from '../src/shared/record-module-tools';
