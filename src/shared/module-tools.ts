// Agent tools that belong to a life module (Wave 5, 24 Oct 2026; the rule: "Agents get tools per module (e.g.
// finance_bill_add, health_checkin_log, family_event_add) and access per sensitivity level"). Each tool names its module:
// it is offered to the side chat and to outside agents only while that module is on, and every call goes through the
// asking agent's gate at the module's level (src/main/modules.ts carries them out). Pure: words and schemas only.

import type { AgentToolDef } from './agent-access';
import { RECORD_MODULE_TOOLS } from './record-module-tools';
import { WORK_TOOLS } from './work-module-tools';
import { PUBLICATION_TOOLS } from './publication-tools';
import { PERSONAL_TOOLS } from './personal-module-tools';
import { LIFE_RECORD_TOOLS } from './life-record-tools';

export interface ModuleToolDef extends AgentToolDef {
  /** The module it belongs to (src/shared/life-modules.ts). */
  module: string;
  /** The words the side chat shows while it runs ("Looked at your Weight for the last 30 days" comes from the answer). */
  step: string;
}

// Finance and Documents and ID (Wave 5 part a): their definitions and answers are src/shared/record-module-tools.ts (the
// same ones the former host app and a chat bot use); src/main/record-modules.ts carries them out.
const RECORD_STEPS: Record<string, string> = {
  finance_bills_due: 'Checked the bills due in Money',
  finance_bill_list: 'Looked through your bills in Money',
  finance_spending: 'Looked at your spending in Money',
  finance_bill_add: 'Added a bill to Money',
  finance_bill_mark_paid: 'Marked a bill paid in Money',
  finance_forecast: 'Looked ahead in Money',
  finance_receipt_add: 'Filed a receipt in Money',
  finance_account_add: 'Added an account to Money',
  finance_budget_add: 'Set a budget in Money',
  finance_csv_import: 'Imported bank transactions in Money',
  document_expiring: 'Checked what expires in Papers',
  document_list: 'Looked through Papers',
  document_add: 'Added a document to Papers',
  document_renewed: 'Renewed a document in Papers',
};
const RECORD_TITLES: Record<string, string> = {
  finance_bills_due: 'Bills due',
  finance_bill_list: 'Bills and subscriptions',
  finance_spending: 'Spending this month',
  finance_bill_add: 'Add a bill',
  finance_bill_mark_paid: 'Mark a bill paid',
  finance_forecast: 'The next 90 days',
  finance_receipt_add: 'File a receipt',
  finance_account_add: 'Add an account',
  finance_budget_add: 'Set a budget',
  finance_csv_import: 'Import bank transactions',
  document_expiring: 'Documents expiring',
  document_list: 'Papers',
  document_add: 'Add a document',
  document_renewed: 'Renew a document',
};

/** Every module's tools (each module's file adds its own). */
export const MODULE_TOOLS: ModuleToolDef[] = [
  ...RECORD_MODULE_TOOLS.map(
    (t): ModuleToolDef => ({
      name: t.name,
      title: RECORD_TITLES[t.name] ?? t.name,
      level: t.write ? 'edit' : 'read',
      ...(t.write ? {} : { readOnly: true }),
      description: t.description,
      input: t.parameters.properties as Record<string, unknown>,
      ...('required' in t.parameters ? { required: [...t.parameters.required] } : {}),
      module: t.module,
      step: RECORD_STEPS[t.name] ?? t.name,
    }),
  ),
  // Meetings, Weekly Updates, Sites and Equipment, and Vendors, Quotes and Contracts (Wave 6 part b): each tool carries
  // its own title and step words (src/shared/work-module-tools.ts); src/main/work-modules.ts carries them out.
  ...WORK_TOOLS.map(
    (t): ModuleToolDef => ({
      name: t.name,
      title: t.title,
      level: t.write ? 'edit' : 'read',
      ...(t.write ? {} : { readOnly: true }),
      description: t.description,
      input: t.parameters.properties,
      ...(t.parameters.required ? { required: [...t.parameters.required] } : {}),
      module: t.module,
      step: t.step,
    }),
  ),
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, Reading, Watching and Lists (Wave 7 part b):
  // src/shared/life-record-tools.ts; src/main/life-records.ts carries them out.
  ...LIFE_RECORD_TOOLS.map(
    (t): ModuleToolDef => ({
      name: t.name,
      title: t.title,
      level: t.write ? 'edit' : 'read',
      ...(t.write ? {} : { readOnly: true }),
      description: t.description,
      input: t.parameters.properties,
      ...(t.parameters.required ? { required: [...t.parameters.required] } : {}),
      module: t.module,
      step: t.step,
    }),
  ),
  // Home, Vehicles, Career and Travel (Wave 7 part a): src/shared/personal-module-tools.ts; src/main/personal-modules.ts
  // carries them out.
  ...PERSONAL_TOOLS.map(
    (t): ModuleToolDef => ({
      name: t.name,
      title: t.title,
      level: t.write ? 'edit' : 'read',
      ...(t.write ? {} : { readOnly: true }),
      description: t.description,
      input: t.parameters.properties,
      ...(t.parameters.required ? { required: [...t.parameters.required] } : {}),
      module: t.module,
      step: t.step,
    }),
  ),
  // Publications (Wave 6 part a): src/shared/publication-tools.ts; src/main/publications.ts carries them out.
  ...PUBLICATION_TOOLS.map(
    (t): ModuleToolDef => ({
      name: t.name,
      title: t.title,
      level: t.write ? 'edit' : 'read',
      ...(t.write ? {} : { readOnly: true }),
      description: t.description,
      input: t.parameters.properties,
      ...(t.parameters.required ? { required: [...t.parameters.required] } : {}),
      module: t.module,
      step: t.step,
    }),
  ),
];

export const moduleToolDef = (name: string): ModuleToolDef | undefined => MODULE_TOOLS.find((t) => t.name === name);
