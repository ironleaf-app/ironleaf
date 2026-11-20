// The personal modules (Wave 7 part a, 24 Oct 2026; the catalogue, 22 Oct, rows 12, 13, 15 and 16):
//   Home       "House, rooms, appliances, warranties, maintenance, utilities, printer and network · Maintenance schedule,
//               warranty expiry, manuals" (Personal)
//   Vehicles   "Cars, rego, insurance, servicing, fuel · Rego and service reminders" (Personal)
//   Career     "Job applications, cover letters, interviews, contacts, outcomes · Application pipeline (applied,
//               interview, offer)" (Personal)
//   Travel     "Trips, flights, hotels, itineraries, expenses, travel forecast · Trip timeline, documents per trip, spend
//               vs budget" (Work / Personal)
//
// Each is made of the vault's shared blocks like the work modules (src/shared/module-records.ts): its records are plain
// notes of its own note types kept in its folder inside an area of life (Home's and Vehicles' in Home, Career's and
// Travel's in Me); its pages are record views; Today, the bell and its agent tools come from the same notes; its level is
// its types' default (Personal whether the module is on or off). A CV is a Documents and ID record (one home per record):
// Career links it. Every rule here is generic: nothing names one person's life. Pure: no files, no Node, no DOM.

import type { RecordModule } from './module-records';

export const APPLICATION_STAGES = ['Saved', 'Applied', 'Interview', 'Offer', 'Accepted', 'Declined', 'Rejected', 'Withdrawn'] as const;
/** The stages still in play (the pipeline's columns). */
export const OPEN_STAGES = ['Saved', 'Applied', 'Interview', 'Offer'] as const;
export const WORK_TYPES = ['Full-time', 'Part-time', 'Contract', 'Casual', 'Internship', 'Other'] as const;
export const INTERVIEW_KINDS = ['Phone screen', 'Video', 'In person', 'Technical', 'Panel', 'Final', 'Other'] as const;
export const INTERVIEW_OUTCOMES = ['Booked', 'Done', 'Went well', 'Not progressed', 'Cancelled'] as const;

export const TRIP_PURPOSES = ['Personal', 'Work', 'Family', 'Other'] as const;
export const TRIP_STATUSES = ['Planning', 'Booked', 'Done', 'Cancelled'] as const;
export const BOOKING_KINDS = ['Flight', 'Hotel', 'Car hire', 'Train', 'Bus', 'Ferry', 'Transfer', 'Activity', 'Meeting', 'Meal', 'Other'] as const;
export const EXPENSE_CATEGORIES = ['Flights', 'Accommodation', 'Transport', 'Food', 'Activities', 'Shopping', 'Fees', 'Other'] as const;

export const OWNERSHIP = ['Owned', 'Renting', 'Other'] as const;
export const APPLIANCE_KINDS = ['Fridge', 'Freezer', 'Washing machine', 'Dryer', 'Dishwasher', 'Oven', 'Cooktop', 'Microwave', 'Air conditioner', 'Heater', 'Hot water', 'TV', 'Printer', 'Router', 'Computer', 'Vacuum', 'Tool', 'Other'] as const;
export const APPLIANCE_STATUSES = ['In use', 'Needs repair', 'In storage', 'Replaced', 'Sold'] as const;
export const UPKEEP_EVERY = ['Weekly', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Every 2 years', 'Every 5 years', 'Once'] as const;
export const UPKEEP_STATUSES = ['Active', 'Paused', 'Done'] as const;
export const UTILITY_KINDS = ['Electricity', 'Gas', 'Water', 'Internet', 'Phone', 'Rates', 'Insurance', 'Other'] as const;

export const VEHICLE_KINDS = ['Car', 'SUV', 'Ute', 'Van', 'Motorbike', 'Truck', 'Trailer', 'Caravan', 'Boat', 'Other'] as const;
export const FUEL_TYPES = ['Petrol', 'Diesel', 'Hybrid', 'Plug-in hybrid', 'Electric', 'LPG'] as const;
export const VEHICLE_STATUSES = ['Active', 'Stored', 'Sold'] as const;

export const CAREER: RecordModule = {
  id: 'career',
  name: 'Career',
  icon: 'career',
  about: 'Job applications from saved to offer, the cover letter and CV version sent with each, interviews and the people you deal with.',
  holds: 'Job applications, cover letters, interviews and contacts',
  level: 'personal',
  area: 'me',
  folder: 'Career',
  locked: '',
  types: [
    {
      id: 'job-application',
      name: 'Application',
      plural: 'Applications',
      icon: 'briefcase',
      color: 'sky',
      hint: 'A job you applied for (or mean to): the company, where it is up to, its interviews, and the letter and CV you sent',
      fields: [
        { key: 'company', kind: 'link', linkType: 'organisation' },
        { key: 'role', kind: 'text' },
        { key: 'stage', kind: 'choice', options: [...APPLICATION_STAGES], initial: 'Applied' },
        { key: 'applied', kind: 'date' },
        { key: 'source', kind: 'text' },
        { key: 'url', kind: 'url' },
        { key: 'location', kind: 'text' },
        { key: 'work_type', kind: 'choice', options: ['', ...WORK_TYPES] },
        { key: 'salary', kind: 'text' },
        { key: 'contacts', kind: 'links', linkType: 'person' },
        { key: 'cv', kind: 'link', linkType: 'id-document' },
        { key: 'letter', kind: 'link', linkType: 'cover-letter' },
        { key: 'next_step', kind: 'text' },
        { key: 'next_date', kind: 'date' },
      ],
      template: '## Interviews\n\n| Date | Time | Kind | With | Where | Outcome | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n\n## Timeline\n\n\n## Notes\n\n',
      sub: 'Applications',
      aliases: ['applications', 'job application', 'job applications'],
      empty: { title: 'No applications yet.', line: 'Add a job you applied for to follow it from applied to offer.' },
      columns: ['company', 'stage', 'applied', 'next_date'],
      dateProp: 'applied',
    },
    {
      id: 'cover-letter',
      name: 'Cover letter',
      plural: 'Cover letters',
      icon: 'mail',
      color: 'sage',
      hint: 'A cover letter: the words, who it was for and the application it went with',
      fields: [
        { key: 'application', kind: 'link', linkType: 'job-application' },
        { key: 'company', kind: 'link', linkType: 'organisation' },
        { key: 'written', kind: 'date' },
        { key: 'version', kind: 'text' },
      ],
      template: '',
      sub: 'Cover letters',
      aliases: ['cover letters', 'letter'],
      empty: { title: 'No cover letters yet.', line: 'Write a cover letter here or keep the one you sent, with its application.' },
      columns: ['company', 'application', 'written', 'version'],
      dateProp: 'written',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'career', line: 'Where each application is up to, interviews coming up and what to follow up.' },
    { id: 'pipeline', label: 'Pipeline', icon: 'board', line: 'Every application in play by its stage. Drag one to move it on.' },
    { id: 'applications', label: 'Applications', icon: 'table', line: 'Every application with its company, stage, dates and outcome.' },
    { id: 'interviews', label: 'Interviews', icon: 'calendar', line: 'Every interview: when, with whom, where and how it went.' },
    { id: 'letters', label: 'Letters and CVs', icon: 'doc', line: 'Cover letters and CV versions, each with the applications it went with.' },
    { id: 'contacts', label: 'Contacts', icon: 'people', line: 'The people you have dealt with, and the applications each is part of.' },
  ],
  tools: ['career_application_list', 'career_application_get', 'career_interviews', 'career_application_add', 'career_set_stage', 'career_interview_add'],
};

export const TRAVEL: RecordModule = {
  id: 'travel',
  name: 'Trips',
  icon: 'plane',
  about: 'Trips with their flights, hotels and day-by-day itinerary, the documents for each, what you spend against the budget and what travel is forecast to cost.',
  holds: 'Trips, flights, hotels, itineraries and travel spending',
  level: 'personal',
  area: 'me',
  folder: 'Travel',
  locked: '',
  types: [
    {
      id: 'trip',
      name: 'Trip',
      plural: 'Trips',
      icon: 'plane',
      color: 'teal',
      hint: 'A trip: where and when, its flights, hotels and plans day by day, its documents, and what it costs against its budget',
      fields: [
        { key: 'destination', kind: 'text' },
        { key: 'purpose', kind: 'choice', options: [...TRIP_PURPOSES], initial: 'Personal' },
        { key: 'starts', kind: 'date' },
        { key: 'ends', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...TRIP_STATUSES], initial: 'Planning' },
        { key: 'budget', kind: 'number' },
        { key: 'travellers', kind: 'links', linkType: 'person' },
        { key: 'project', kind: 'link', linkType: 'project' },
      ],
      template: '## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n\n## Expenses\n\n| Date | What | Category | Amount | Paid by | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Trips',
      aliases: ['trips', 'journey', 'holiday'],
      empty: { title: 'No trips yet.', line: 'Add a trip to keep its flights, hotels, documents and spending together.' },
      columns: ['destination', 'starts', 'ends', 'purpose', 'status'],
      dateProp: 'starts',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'plane', line: 'Your next trip day by day, what is coming up, and spending against each budget.' },
    { id: 'trips', label: 'Trips', icon: 'table', line: 'Every trip with its dates, purpose, budget and forecast. Open one for its itinerary.' },
    { id: 'timeline', label: 'Timeline', icon: 'timeline', line: 'Your trips on a timeline.' },
    { id: 'itinerary', label: 'Itinerary', icon: 'calendar', line: 'Every flight, hotel and plan of every trip on the calendar.' },
    { id: 'expenses', label: 'Expenses', icon: 'receipt', line: 'What each trip has cost, by category.' },
    { id: 'forecast', label: 'Forecast', icon: 'chart', line: 'What travel is forecast to cost, month by month, against the budgets.' },
  ],
  tools: ['travel_trip_list', 'travel_trip_get', 'travel_forecast', 'travel_trip_add', 'travel_itinerary_add', 'travel_expense_add'],
};

export const HOUSE: RecordModule = {
  id: 'house',
  name: 'House',
  icon: 'home',
  about: 'Your home, its rooms and utilities, the printer and network notes, appliances with their manuals and warranties, and a maintenance schedule that says what is due.',
  holds: 'The house, appliances, warranties, maintenance and utilities',
  level: 'personal',
  area: 'home',
  folder: 'House',
  locked: 'Wi-Fi and router passwords go in Secrets, never in a note.',
  types: [
    {
      id: 'house',
      name: 'House',
      plural: 'Houses',
      icon: 'home',
      color: 'ochre',
      hint: 'Your house: its address, rooms, utilities, and the printer and network notes',
      fields: [
        { key: 'address', kind: 'text' },
        { key: 'ownership', kind: 'choice', options: [...OWNERSHIP], initial: 'Owned' },
        { key: 'moved_in', kind: 'date' },
        { key: 'contact', kind: 'link', linkType: 'person' },
      ],
      template: '## Rooms\n\n| Room | Floor | Notes |\n| --- | --- | --- |\n\n## Utilities\n\n| Utility | Provider | Plan | Account | Phone | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Network and printers\n\n| Thing | Details | Notes |\n| --- | --- | --- |\n\n## Notes\n\n',
      sub: '',
      aliases: ['home', 'homes', 'property'],
      empty: { title: 'No houses yet.', line: 'Add your house to keep its rooms, utilities and network notes together.' },
      columns: ['address', 'ownership', 'moved_in'],
    },
    {
      id: 'appliance',
      name: 'Appliance',
      plural: 'Appliances',
      icon: 'bolt',
      color: 'stone',
      hint: 'An appliance or device at home: its model and serial, room, warranty, manual and service history',
      fields: [
        { key: 'kind', kind: 'choice', options: [...APPLIANCE_KINDS], initial: 'Other' },
        { key: 'room', kind: 'text' },
        { key: 'make', kind: 'text' },
        { key: 'model', kind: 'text' },
        { key: 'serial', kind: 'text' },
        { key: 'purchased', kind: 'date' },
        { key: 'price', kind: 'number' },
        { key: 'supplier', kind: 'text' },
        { key: 'warranty', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...APPLIANCE_STATUSES], initial: 'In use' },
      ],
      template: '## Service history\n\n| Date | What | By | Cost | Notes |\n| --- | --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Appliances',
      aliases: ['appliances', 'home device'],
      empty: { title: 'No appliances yet.', line: 'Add an appliance with its warranty and manual so both are there when you need them.' },
      columns: ['kind', 'room', 'make', 'warranty', 'status'],
      dateProp: 'warranty',
    },
    {
      id: 'upkeep',
      name: 'Maintenance job',
      plural: 'Maintenance',
      icon: 'task',
      color: 'clay',
      hint: 'A job that comes round (clean the gutters, service the air conditioner): how often, when it was last done and when it is next due',
      fields: [
        { key: 'every', kind: 'choice', options: [...UPKEEP_EVERY], initial: 'Yearly' },
        { key: 'last_done', kind: 'date' },
        { key: 'next_due', kind: 'date' },
        { key: 'appliance', kind: 'link', linkType: 'appliance' },
        { key: 'room', kind: 'text' },
        { key: 'who', kind: 'text' },
        { key: 'cost', kind: 'number' },
        { key: 'status', kind: 'choice', options: [...UPKEEP_STATUSES], initial: 'Active' },
      ],
      template: '## Done\n\n| Date | By | Cost | Notes |\n| --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Maintenance',
      aliases: ['maintenance', 'maintenance job', 'chore'],
      empty: { title: 'No maintenance jobs yet.', line: 'Add a job that comes round to be told when it is due.' },
      columns: ['every', 'next_due', 'last_done', 'who'],
      dateProp: 'next_due',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'home', line: 'Maintenance due, warranties ending and your home at a glance.' },
    { id: 'house', label: 'House', icon: 'grid', line: 'Rooms, utilities, and the printer and network notes. Everything changes where it shows.' },
    { id: 'appliances', label: 'Appliances', icon: 'bolt', line: 'Every appliance with its room, model, serial, warranty and manual.' },
    { id: 'maintenance', label: 'Maintenance', icon: 'task', line: 'Every job that comes round, when it was last done and when it is next due.' },
    { id: 'warranties', label: 'Warranties', icon: 'clock', line: 'Each appliance on the day its warranty ends.' },
    { id: 'manuals', label: 'Manuals', icon: 'file', line: 'Manuals, receipts and other files kept with each appliance.' },
  ],
  tools: ['home_info', 'home_appliance_find', 'home_maintenance_due', 'home_appliance_add', 'home_maintenance_add', 'home_maintenance_done'],
};

export const VEHICLES: RecordModule = {
  id: 'vehicles',
  name: 'Cars',
  icon: 'car',
  about: 'Cars and other vehicles with their rego, insurance and servicing reminders, a fuel log with its trend, and the service history.',
  holds: 'Vehicles, rego, insurance, servicing and fuel',
  level: 'personal',
  area: 'home',
  folder: 'Vehicles',
  locked: '',
  types: [
    {
      id: 'vehicle',
      name: 'Vehicle',
      plural: 'Vehicles',
      icon: 'car',
      color: 'slate',
      hint: 'A car, bike, van or trailer: its rego, insurance and service dates, its fuel log and service history',
      fields: [
        { key: 'kind', kind: 'choice', options: [...VEHICLE_KINDS], initial: 'Car' },
        { key: 'make', kind: 'text' },
        { key: 'model', kind: 'text' },
        { key: 'year', kind: 'number' },
        { key: 'rego', kind: 'text' },
        { key: 'rego_due', kind: 'date' },
        { key: 'insurer', kind: 'text' },
        { key: 'insurance_due', kind: 'date' },
        { key: 'service_due', kind: 'date' },
        { key: 'service_km', kind: 'number' },
        { key: 'fuel', kind: 'choice', options: [...FUEL_TYPES], initial: 'Petrol' },
        { key: 'vin', kind: 'text' },
        { key: 'status', kind: 'choice', options: [...VEHICLE_STATUSES], initial: 'Active' },
      ],
      template: '## Fuel log\n\n| Date | Odometer | Litres | Cost | Full | Station | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n\n## Service history\n\n| Date | Odometer | What | Where | Cost | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Distance log\n\n| Date | Reason | From | To | Km | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: '',
      aliases: ['vehicles', 'car', 'cars'],
      empty: { title: 'No vehicles yet.', line: 'Add a vehicle to be told before its rego, insurance or service is due.' },
      columns: ['make', 'model', 'rego', 'rego_due', 'service_due'],
      dateProp: 'rego_due',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'car', line: 'Each vehicle with what is due, its last fill and how its fuel use is trending.' },
    { id: 'vehicles', label: 'Cars', icon: 'table', line: 'Every vehicle with its rego, insurance and service dates.' },
    { id: 'fuel', label: 'Fuel', icon: 'fuel', line: 'Every fill-up with its price, and fuel use between full tanks.' },
    { id: 'service', label: 'Service', icon: 'settings', line: 'Each vehicle’s service history and when the next one is due.' },
    { id: 'distance', label: 'Distance', icon: 'car', line: 'Trips logged with their kilometres, added up per financial year for tax time.' },
    { id: 'reminders', label: 'Reminders', icon: 'bell', line: 'Rego, insurance and service due dates on the calendar.' },
  ],
  tools: ['vehicle_list', 'vehicle_due', 'vehicle_fuel_trend', 'vehicle_fuel_add', 'vehicle_service_add', 'vehicle_renewed', 'vehicle_distance', 'vehicle_trip_add'],
};

/** The personal modules, in the order Settings › Packs shows them. */
export const PERSONAL_MODULES: RecordModule[] = [HOUSE, VEHICLES, CAREER, TRAVEL];
export const PERSONAL_MODULE_IDS = PERSONAL_MODULES.map((m) => m.id);

/** How many days ahead each personal module says something is coming (a module's options can change it). */
export const PERSONAL_REMIND: Record<string, number> = { house: 60, vehicles: 30, career: 2, travel: 7 };
