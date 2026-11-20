// The work modules (Wave 6 part b, 24 Oct 2026; the catalogue, 22 Oct, rows 2, 3, 5 and 6):
//   Meetings                 "Agenda, attendees, notes, decisions, actions · Actions flow into project next steps;
//                             transcript import" (Work)
//   Weekly Updates           "One update per week, a section per workstream, metrics · History per workstream, trend
//                             charts, export to text, Word or PDF" (Work; the full spec is section 5.1 of the plan)
//   Sites and Equipment      "Stores, offices, rooms, devices with serials, patch points, photos · Per-site register,
//                             inventory, warranty and end-of-life, patch schedule" (Work)
//   Vendors, Quotes and Contracts  "Quotes, POs, contracts, validity, amounts · Expiry alerts, compare quotes, link to
//                             project" (Work-confidential)
//
// Each is made of the vault's shared blocks like Finance and Documents and ID (src/shared/module-records.ts): its records
// are plain notes of its own note types (a meeting is the vault's own Meeting note), kept in its folder inside the Work
// area; its pages are record views; Today, the bell and its agent tools come from the same notes; its level is its
// types' default (a quote is Work-confidential whether the module is on or off). Every rule here is generic: nothing
// names one person's work. Pure: no files, no Node, no DOM.

import type { RecordModule } from './module-records';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const SERIES_CADENCES = ['Weekly', 'Fortnightly', 'Monthly', 'Ad hoc'] as const;
export const UPDATE_STATUSES = ['Draft', 'Sent'] as const;
export const UPDATE_FLAGS = ['On track', 'At risk', 'Blocked', 'Done'] as const;
export const SITE_KINDS = ['Office', 'Store', 'Warehouse', 'Data centre', 'Venue', 'Showroom', 'Home', 'Other'] as const;
export const SITE_STATUSES = ['Active', 'Planned', 'Moving', 'Closing', 'Closed'] as const;
export const DEVICE_KINDS = ['Laptop', 'Desktop', 'Tablet', 'Phone', 'POS', 'Printer', 'Display', 'AV', 'Camera', 'Switch', 'Router', 'Access point', 'Firewall', 'Server', 'Other'] as const;
export const DEVICE_STATUSES = ['In use', 'Spare', 'On order', 'In repair', 'Retired'] as const;
export const PATCH_STATUSES = ['Live', 'To patch', 'Planned', 'Faulty', 'Spare'] as const;
export const VENDOR_CATEGORIES = ['Hardware', 'Software', 'Services', 'Telco', 'AV', 'Facilities', 'Consulting', 'Other'] as const;
export const VENDOR_STATUSES = ['Active', 'Preferred', 'On hold', 'Former'] as const;
export const QUOTE_STATUSES = ['Requested', 'Received', 'Accepted', 'Declined', 'Lapsed', 'Superseded'] as const;
export const PO_STATUSES = ['Draft', 'Raised', 'Approved', 'Delivered', 'Invoiced', 'Paid', 'Cancelled'] as const;
export const CONTRACT_PERIODS = ['One-off', 'Monthly', 'Quarterly', 'Yearly'] as const;
export const CONTRACT_RENEWALS = ['Ends', 'Auto-renews', 'Option to renew'] as const;
export const CONTRACT_STATUSES = ['Draft', 'Active', 'Ending', 'Ended'] as const;

export const MEETINGS: RecordModule = {
  id: 'meetings',
  name: 'Meetings',
  icon: 'calendar',
  about: 'Agenda, attendees, notes, decisions and actions for every meeting, with series, a prep pack before each one and its actions carried into the project’s next steps.',
  holds: 'Meetings, their agendas, decisions and actions',
  level: 'open',
  area: 'work',
  folder: 'Meetings',
  locked: '',
  types: [
    {
      id: 'meeting-series',
      name: 'Meeting series',
      plural: 'Meeting series',
      icon: 'calendar',
      color: 'ochre',
      hint: 'A meeting that comes round (a weekly sync, a monthly review): who comes, when, and its standing agenda',
      fields: [
        { key: 'cadence', kind: 'choice', options: [...SERIES_CADENCES], initial: 'Weekly' },
        { key: 'day', kind: 'choice', options: ['', ...WEEKDAYS] },
        { key: 'time', kind: 'time' },
        { key: 'attendees', kind: 'links', linkType: 'person' },
        { key: 'project', kind: 'link', linkType: 'project' },
        { key: 'where', kind: 'text' },
      ],
      template: '## Purpose\n\n\n## Standing agenda\n\n- \n\n## Notes\n\n',
      sub: 'Series',
      aliases: ['meeting series', 'series'],
      empty: { title: 'No meeting series yet.', line: 'Make a series for a meeting that comes round, so each one starts from the last.' },
      columns: ['cadence', 'day', 'time', 'project'],
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'calendar', line: 'What’s coming up with its prep pack, and the actions from your meetings still open.' },
    { id: 'all', label: 'All meetings', icon: 'table', line: 'Every meeting with its attendees, project, decisions and open actions.' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', line: 'Your meetings on the month.' },
    { id: 'actions', label: 'Actions', icon: 'task', line: 'Every action from every meeting: who, by when, and which project it is.' },
    { id: 'decisions', label: 'Decisions', icon: 'flag', line: 'Every decision made in a meeting, newest first.' },
    { id: 'questions', label: 'Questions', icon: 'help', line: 'Every question asked in a meeting, open until answered.' },
    { id: 'series', label: 'Series', icon: 'history', line: 'Meetings that come round, each starting from the last.' },
  ],
  tools: ['meeting_list', 'meeting_get', 'meeting_prep', 'meeting_add'],
};

export const WEEKLY: RecordModule = {
  id: 'weekly',
  name: 'Weekly',
  icon: 'review',
  about: 'One status update a week, a section per workstream with its project, flag, progress, next steps, blockers and metrics, started from last week’s and sent as text, Word or PDF.',
  holds: 'Weekly status updates, by workstream',
  level: 'open',
  area: 'work',
  folder: 'Weekly Updates',
  locked: '',
  types: [
    {
      id: 'weekly-update',
      name: 'Weekly update',
      plural: 'Weekly updates',
      icon: 'chart',
      color: 'sky',
      hint: 'One week’s status update: a section per workstream, with metrics kept as numbers',
      fields: [
        { key: 'week', kind: 'date' },
        { key: 'audience', kind: 'text' },
        { key: 'status', kind: 'choice', options: [...UPDATE_STATUSES], initial: 'Draft' },
        { key: 'sent', kind: 'date' },
        { key: 'sent_by', kind: 'text' },
      ],
      template: '',
      sub: '',
      aliases: ['weekly update', 'weekly updates', 'status update'],
      empty: { title: 'No weekly updates yet.', line: 'Start this week’s update: each workstream gets its own section.' },
      columns: ['week', 'audience', 'status', 'sent'],
      dateProp: 'week',
    },
  ],
  sections: [
    { id: 'overview', label: 'This week', icon: 'review', line: 'This week’s update, a section per workstream. Everything shown changes where it is.' },
    { id: 'history', label: 'History', icon: 'history', line: 'Every week’s update, newest first.' },
    { id: 'workstreams', label: 'Workstreams', icon: 'chart', line: 'Each workstream week by week: its status, blockers and metrics as a trend.' },
  ],
  tools: ['weekly_update_create', 'weekly_update_get', 'weekly_update_add_section', 'weekly_update_set_metric', 'weekly_update_mark_sent'],
};

export const SITES: RecordModule = {
  id: 'sites',
  name: 'Sites',
  icon: 'server',
  about: 'Sites and their rooms, devices with serials and warranties, patch points and photos: a register for each site, the inventory, the patch schedule and what reaches end of life.',
  holds: 'Sites, rooms, devices, patch points and warranties',
  level: 'open',
  area: 'work',
  folder: 'Sites and Equipment',
  locked: '',
  types: [
    {
      id: 'site',
      name: 'Site',
      plural: 'Sites',
      icon: 'pin',
      color: 'teal',
      hint: 'An office, store, warehouse or venue: its rooms, patch points, devices and photos',
      fields: [
        { key: 'kind', kind: 'choice', options: [...SITE_KINDS], initial: 'Office' },
        { key: 'code', kind: 'text' },
        { key: 'address', kind: 'text' },
        { key: 'contact', kind: 'link', linkType: 'person' },
        { key: 'status', kind: 'choice', options: [...SITE_STATUSES], initial: 'Active' },
        { key: 'project', kind: 'link', linkType: 'project' },
      ],
      template: '## Rooms\n\n| Room | Floor | Purpose | Notes |\n| --- | --- | --- | --- |\n\n## Patch points\n\n| Point | Room | Switch | Port | VLAN | Device | Status | Date | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Sites',
      aliases: ['sites', 'store', 'office'],
      empty: { title: 'No sites yet.', line: 'Add a site to keep its rooms, devices and patch points together.' },
      columns: ['kind', 'code', 'address', 'status'],
    },
    {
      id: 'device',
      name: 'Device',
      plural: 'Equipment',
      icon: 'tag',
      color: 'slate',
      hint: 'A device with its serial: where it is, whose it is, its warranty and end of life',
      fields: [
        { key: 'kind', kind: 'choice', options: [...DEVICE_KINDS], initial: 'Laptop' },
        { key: 'site', kind: 'link', linkType: 'site' },
        { key: 'room', kind: 'text' },
        { key: 'make', kind: 'text' },
        { key: 'model', kind: 'text' },
        { key: 'serial', kind: 'text' },
        { key: 'asset_tag', kind: 'text' },
        { key: 'status', kind: 'choice', options: [...DEVICE_STATUSES], initial: 'In use' },
        { key: 'assigned', kind: 'link', linkType: 'person' },
        { key: 'purchased', kind: 'date' },
        { key: 'warranty', kind: 'date' },
        { key: 'eol', kind: 'date' },
      ],
      template: '## Notes\n\n',
      sub: 'Equipment',
      aliases: ['devices', 'equipment', 'asset', 'assets'],
      empty: { title: 'No equipment yet.', line: 'Add a device with its serial to know where it is and when its warranty ends.' },
      columns: ['kind', 'site', 'serial', 'status', 'warranty'],
      dateProp: 'warranty',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'server', line: 'Your sites, the spare pool, patch work to do and warranties ending.' },
    { id: 'sites', label: 'Sites', icon: 'pin', line: 'Every site with its rooms, devices and patch points. Open one for its register.' },
    { id: 'inventory', label: 'Inventory', icon: 'table', line: 'Every device: where it is, its serial, whose it is and its status.' },
    { id: 'patch', label: 'Patch schedule', icon: 'branch', line: 'Every patch point at every site: what is live, what is to patch and when.' },
    { id: 'lifecycle', label: 'Warranty and end of life', icon: 'clock', line: 'Each device on the day its warranty ends, and when it reaches end of life.' },
  ],
  tools: ['site_list', 'site_register', 'device_find', 'device_add', 'equipment_expiring'],
};

export const VENDORS: RecordModule = {
  id: 'vendors',
  name: 'Suppliers',
  icon: 'briefcase',
  about: 'Vendors, their quotes, purchase orders and contracts with amounts and validity: what lapses or ends soon, quotes side by side, each linked to its project.',
  holds: 'Vendors, quotes, purchase orders and contracts',
  level: 'work',
  area: 'work',
  folder: 'Vendors and Contracts',
  locked: '',
  types: [
    {
      id: 'vendor',
      name: 'Vendor',
      plural: 'Vendors',
      icon: 'briefcase',
      color: 'clay',
      hint: 'A supplier: who to talk to, what they supply, their quotes and contracts',
      fields: [
        { key: 'category', kind: 'choice', options: [...VENDOR_CATEGORIES], initial: 'Other' },
        { key: 'contact', kind: 'link', linkType: 'person' },
        { key: 'email', kind: 'email' },
        { key: 'phone', kind: 'phone' },
        { key: 'website', kind: 'url' },
        { key: 'status', kind: 'choice', options: [...VENDOR_STATUSES], initial: 'Active' },
      ],
      template: '## Notes\n\n',
      sub: 'Vendors',
      aliases: ['vendors', 'supplier', 'suppliers'],
      empty: { title: 'No vendors yet.', line: 'Add a vendor to keep their quotes and contracts together.' },
      columns: ['category', 'contact', 'status'],
    },
    {
      id: 'quote',
      name: 'Quote',
      plural: 'Quotes',
      icon: 'tag',
      color: 'ochre',
      hint: 'A vendor’s quote: its amount, how long it is valid and the project it is for',
      fields: [
        { key: 'vendor', kind: 'link', linkType: 'vendor' },
        { key: 'project', kind: 'link', linkType: 'project' },
        { key: 'amount', kind: 'number' },
        { key: 'currency', kind: 'text' },
        { key: 'received', kind: 'date' },
        { key: 'valid_until', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...QUOTE_STATUSES], initial: 'Received' },
        { key: 'reference', kind: 'text' },
        { key: 'version', kind: 'text' },
      ],
      template: '## Items\n\n| Item | Qty | Unit price | Total |\n| --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Quotes',
      aliases: ['quotes', 'quotation', 'quotations'],
      empty: { title: 'No quotes yet.', line: 'Add a quote to be told before it lapses, and to compare it with others.' },
      columns: ['vendor', 'project', 'amount', 'valid_until', 'status'],
      dateProp: 'valid_until',
    },
    {
      id: 'purchase-order',
      name: 'Purchase order',
      plural: 'Purchase orders',
      icon: 'receipt',
      color: 'stone',
      hint: 'A purchase order raised with a vendor: its number, amount and where it is up to',
      fields: [
        { key: 'vendor', kind: 'link', linkType: 'vendor' },
        { key: 'project', kind: 'link', linkType: 'project' },
        { key: 'quote', kind: 'link', linkType: 'quote' },
        { key: 'number', kind: 'text' },
        { key: 'amount', kind: 'number' },
        { key: 'raised', kind: 'date' },
        { key: 'delivery', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...PO_STATUSES], initial: 'Raised' },
      ],
      template: '## Notes\n\n',
      sub: 'Purchase orders',
      aliases: ['purchase orders', 'po', 'pos'],
      empty: { title: 'No purchase orders yet.', line: 'Add a purchase order to follow it from raised to paid.' },
      columns: ['vendor', 'number', 'amount', 'status'],
      dateProp: 'raised',
    },
    {
      id: 'contract',
      name: 'Contract',
      plural: 'Contracts',
      icon: 'doc',
      color: 'plum',
      hint: 'A contract with a vendor: its value, when it starts and ends, notice and renewal',
      fields: [
        { key: 'vendor', kind: 'link', linkType: 'vendor' },
        { key: 'project', kind: 'link', linkType: 'project' },
        { key: 'amount', kind: 'number' },
        { key: 'period', kind: 'choice', options: [...CONTRACT_PERIODS], initial: 'Yearly' },
        { key: 'starts', kind: 'date' },
        { key: 'ends', kind: 'date' },
        { key: 'notice_days', kind: 'number' },
        { key: 'renewal', kind: 'choice', options: [...CONTRACT_RENEWALS], initial: 'Ends' },
        { key: 'status', kind: 'choice', options: [...CONTRACT_STATUSES], initial: 'Active' },
        { key: 'reference', kind: 'text' },
      ],
      template: '## Files\n\n\n## Notes\n\n',
      sub: 'Contracts',
      aliases: ['contracts', 'agreement', 'agreements'],
      empty: { title: 'No contracts yet.', line: 'Add a contract to be told before its notice period starts.' },
      columns: ['vendor', 'amount', 'ends', 'status'],
      dateProp: 'ends',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'briefcase', line: 'What lapses or ends soon, open quotes and orders, and each vendor’s work.' },
    { id: 'vendors', label: 'Vendors', icon: 'briefcase', line: 'Every vendor with their open quotes, orders and contracts. Open one for everything with them.' },
    { id: 'quotes', label: 'Quotes', icon: 'tag', line: 'Every quote with its amount, validity and project.' },
    { id: 'compare', label: 'Compare quotes', icon: 'table', line: 'Quotes for the same project side by side, item by item.' },
    { id: 'orders', label: 'Purchase orders', icon: 'receipt', line: 'Every purchase order from raised to paid.' },
    { id: 'contracts', label: 'Contracts', icon: 'doc', line: 'Every contract on the day it ends, with its notice and renewal.' },
  ],
  tools: ['vendor_list', 'quote_list', 'quote_compare', 'quote_add', 'contract_expiring', 'contract_add'],
};

/** The work modules, in the order Settings › Packs shows them. */
export const WORK_MODULES: RecordModule[] = [MEETINGS, WEEKLY, SITES, VENDORS];
export const WORK_MODULE_IDS = WORK_MODULES.map((m) => m.id);

/** A project as a module's records name it: its name and its file's name, lowercased (a link to the file matches too). */
export const projectNameKeys = (p: { path: string; name: string }): string[] => [p.name.toLowerCase(), p.path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase()];

/** Words that say a note or a capture is about one work module's things (module offers, module-records.ts). */
export const WORK_SIGNALS: Record<string, RegExp> = {
  meetings: /\b(meeting|minutes|agenda|catch-?up|stand-?up|kick-?off|workshop|attendees)\b/i,
  weekly: /\b(weekly (?:status )?update|status update|weekly report|week of \d)/i,
  sites: /\b(serial(?: number)?|asset tag|patch (?:point|panel|lead)|warranty|end of life|switch port|vlan|site survey|spare pool)\b/i,
  vendors: /\b(quotes?|quotations?|purchase orders?|vendors?|suppliers?|valid until|contract (?:renewal|ends?|expir\w*|value)|statement of work)\b/i,
};

/** How many days ahead each work module says something is coming (a module's options can change it). */
export const WORK_REMIND: Record<string, number> = { meetings: 1, weekly: 0, sites: 90, vendors: 30 };
