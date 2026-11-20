// Finding notes by what they mean (2 Nov 2026, 10.0 "Endless Tech": chose on-PC only, no provider). A term-expansion
// model, worked out on this PC from the notes alone: stemming, stopwords, synonym and topic groups, and phrases
// ("delivery date" reads as deadline). Each note's ideas hash into a small vector for the Related seam
// (src/shared/related.ts) and for search's "Similar meaning" hits. Kilobytes, no model file, nothing sent anywhere,
// private notes never indexed (src/main/meaning-index.ts refuses them). Pure: no Node, no DOM. Real embeddings (Wave
// 2, same day, still on this PC only) sit behind the same seam: 384-wide vectors from the on-device model
// (src/main/meaning-embed.ts), cached per note (src/main/meaning-build.ts). Everything below the line stays as the
// fallback when the model cannot load.

import { foldDiacritics } from './markdown';

/** The on-device model's vectors are this wide (all-MiniLM-L6-v2: 384, mean pooling, L2 normalised). */
export const EMBED_DIM = 384;
/** Embedding candidates reach confirmation at this cosine or above (6 Nov 2026, find-by-meaning: the walk's
 *  "renting a new shop" ranked its note first at 0.3442, below the old 0.35 prefilter, so the decider below never
 *  saw it. The prefilter only keeps obvious non-candidates from the reranker; the confirm bar decides what shows,
 *  with the reranker or alone, so this floor sits well under it, and nonsense still finds nothing). */
export const EMBED_SEARCH_MIN = 0.3;
/** An embedding meaning hit shows unasked at this cosine or above (v12search, 2 Nov 2026: nonsense must find
 *  nothing with the real model. Measured on the shots-w4vault fixture: pure nonsense tops 0.3936 ("zzz-no-such-note"
 *  against the Launch notes), true paraphrases start at 0.4140, so the bar sits between. Below it a hit shows only
 *  when the reranker confirms it. The retrieval bar above stays where it was: confirmation only ever drops. */
export const EMBED_CONFIRM_MIN = 0.405;
/** With the reranker loaded, an embedding meaning hit below the confirm bar shows when the cross-encoder rates it
 *  this relevant or better (v12search, 2 Nov 2026, measured on the same fixture: nonsense pairs that reach
 *  confirmation top 2.1e-5, the rescued paraphrase ("how many people fit in the venue") scores 5.2e-5, so the bar
 *  sits between at 4e-5. The cosine bar above still decides on its own when the reranker is not loaded). */
export const RERANK_CONFIRM_MIN = 0.00004;
/** The model reads at most this many tokens of one piece of text (its own ceiling is 512; 256 keeps it quick). */
export const EMBED_MAX_TOKENS = 256;
/** A long note is embedded in at most this many pieces (its opening first, where the gist usually sits). */
export const EMBED_MAX_CHUNKS = 8;
/** The reranker re-scores at most this many top results of a search (10.0 m10rerank, 2 Nov 2026: agreed to the
 *  on-device reranker; "the other 2 use"). */
export const RERANK_MAX = 30;
/** A rerank pair's budgets (10.0 m10rerank): the query and the result text, cut so 30 pairs stay under 300 ms on the
 *  normal threaded path (measured: 30 typical pairs ~85 ms in one batched run; pathological texts still answer). */
export const RERANK_MAX_QUERY_TOKENS = 32;
export const RERANK_MAX_TEXT_TOKENS = 64;
/** A result's text is cut to this many characters before scoring (its title first, then its best lines). */
export const RERANK_MAX_TEXT_CHARS = 600;

/** Finding by meaning now: building, ready, or on the word-matching fallback (the model could not load). */
export interface MeaningStatus {
  mode: 'starting' | 'ready' | 'fallback';
  /** Notes being worked out right now (true on first open, then briefly as notes change). */
  busy: boolean;
  done: number;
  todo: number;
  /** Notes with an on-device vector now. */
  embedded: number;
  /** The quiet line the person sees ('' when there is nothing to say). */
  words: string;
}

/** The calm status: nothing being worked out, nothing to say. */
export const MEANING_STATUS_QUIET: MeaningStatus = { mode: 'starting', busy: false, done: 0, todo: 0, embedded: 0, words: '' };

/** Hashed idea vectors are this wide: about a kilobyte a note, fast enough for a laptop vault. */
export const MEANING_DIM = 128;
/** A note reaches search's Similar meaning only at this cosine or above (tuned on paraphrase fixtures). */
export const MEANING_SEARCH_MIN = 0.25;
/** A hashed meaning hit shares at least this many ideas with the query (10.0 third round F4, 2 Nov 2026: a tiny
 *  query vector normalises away its own weakness, so one shared trivial word ("note") cleared 0.25 against six
 *  fixture notes and the empty state never showed. Measured: nonsense shares 1, true paraphrases 3 to 6, short
 *  true queries 3, so the bar sits between. Cosine alone never admits a hit). */
export const MEANING_COVER_MIN = 2;
/** How many meaning hits search adds after the word matches (word matches always come first). */
export const MEANING_SEARCH_MAX = 5;
/** Ideas count full; the bare words count this much (paraphrase with no shared words still scores). */
const WORD_SHARE = 0.3;

/** Words too common to say anything about meaning (search still finds them; they just don't expand). */
const STOP_MEANING = new Set(
  `${'a an and are as at be but by for from has have i if in into is it its of on or our so than that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also about after before over more most some such only own same very s t'} he her his me my him himself herself itself themselves ourselves yours ours theirs myself yourself been being had having doing may might shall must really quite rather still already yet even ever much many lot lots thing things something anything nothing everything one ones well across per via within without towards toward amongst among between through during under while whilst although though because since until unless whether either neither both each every any all few several here am us`.split(
    ' ',
  ),
);

/** A light stem: plurals and -ly only (verbs keep their inflections in the groups, so doubling stays right). */
export function stem(word: string): string {
  const w = word;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ches') || w.endsWith('shes') || w.endsWith('xes') || w.endsWith('zes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    const s = w.slice(0, -1);
    if (s.endsWith('ly') && s.length > 4) return s.slice(0, -2);
    return s;
  }
  if (w.endsWith('ly') && w.length > 5) return w.slice(0, -2);
  return w;
}

/**
 * Ideas that read as one: synonyms and close relates, plus a few broad topics (supply, money) so a vendor note and a
 * supplier query meet even through different words. One line per idea; a word may sit in several ideas.
 */
const CONCEPTS: readonly (readonly string[])[] = [
  ['supplier', 'suppliers', 'vendor', 'vendors', 'contractor', 'contractors', 'provider', 'providers', 'merchant', 'merchants', 'seller', 'sellers', 'distributor', 'distributors', 'wholesaler', 'wholesalers', 'stockist', 'stockists'],
  ['customer', 'customers', 'client', 'clients', 'buyer', 'buyers', 'purchaser', 'purchasers', 'patron', 'patrons'],
  ['delivery', 'deliveries', 'shipment', 'shipments', 'consignment', 'consignments', 'dispatch', 'dispatches', 'dispatched', 'dispatching', 'freight', 'parcel', 'parcels', 'courier', 'couriers', 'post', 'postage', 'drop', 'drops', 'dropoff', 'drop-off'],
  ['order', 'orders', 'ordered', 'ordering', 'purchase', 'purchases', 'purchased', 'purchasing', 'booking', 'bookings', 'booked', 'request', 'requests', 'requested', 'requesting', 'requisition', 'procurement'],
  ['stock', 'stocks', 'inventory', 'inventories', 'supply', 'supplies', 'supplied', 'supplying', 'goods', 'merchandise', 'material', 'materials', 'part', 'parts', 'component', 'components'],
  ['warehouse', 'warehouses', 'depot', 'depots', 'storehouse', 'storage', 'storeroom', 'shed', 'sheds', 'yard', 'yards', 'stockroom'],
  ['date', 'dates', 'deadline', 'deadlines', 'due', 'schedule', 'schedules', 'scheduled', 'scheduling', 'eta', 'etas', 'timeline', 'timelines', 'timeframe', 'timeframes', 'slot', 'slots', 'cutoff', 'cutoffs', 'promised', 'target-date'],
  ['late', 'lately', 'lateness', 'overdue', 'delayed', 'delay', 'delays', 'delaying', 'missed', 'miss', 'misses', 'missing', 'slip', 'slips', 'slipped', 'slipping', 'slippage', 'behind', 'tardy', 'tardiness', 'unpunctual', 'slow', 'slowly', 'slowness', 'deferred', 'defer', 'deferring', 'postpone', 'postponed', 'postponing', 'postponement', 'pushed-back', 'pushback'],
  ['early', 'earlier', 'earliest', 'punctual', 'punctuality', 'ahead', 'prompt', 'promptly', 'promptness', 'timely', 'timeliness'],
  ['again', 'repeated', 'repeatedly', 'repeat', 'repeats', 'repeating', 'repetition', 'continual', 'continually', 'continue', 'continues', 'continued', 'continuing', 'persistent', 'persistently', 'persist', 'often', 'frequently', 'frequent', 'usually', 'usual', 'always', 'constant', 'constantly', 'keeps', 'keep', 'keeping', 'kept', 'never-ending', 'third-time', 'second-time'],
  ['review', 'reviews', 'reviewed', 'reviewing', 'check', 'checks', 'checked', 'checking', 'assess', 'assessed', 'assessing', 'assessment', 'evaluate', 'evaluated', 'evaluating', 'evaluation', 'audit', 'audits', 'audited', 'auditing', 'appraisal', 'appraise', 'appraised', 'inspect', 'inspected', 'inspecting', 'inspection', 'examine', 'examined', 'examining'],
  ['switch', 'switches', 'switched', 'switching', 'change', 'changes', 'changed', 'changing', 'move', 'moves', 'moved', 'moving', 'replace', 'replaces', 'replaced', 'replacing', 'replacement', 'swap', 'swaps', 'swapped', 'swapping', 'alternative', 'alternatives', 'other', 'another', 'new', 'different', 'instead'],
  ['supplier', 'vendor', 'contractor', 'provider', 'delivery', 'shipment', 'consignment', 'dispatch', 'freight', 'order', 'purchase', 'stock', 'inventory', 'supply', 'goods', 'warehouse', 'depot', 'storage', 'procurement', 'distributor', 'wholesaler', 'merchant', 'seller', 'customer', 'client', 'buyer'],
  ['bill', 'bills', 'billed', 'billing', 'invoice', 'invoices', 'invoiced', 'invoicing', 'receipt', 'receipts', 'statement', 'statements', 'charge', 'charges', 'charged', 'charging', 'fee', 'fees', 'cost', 'costs', 'costing', 'price', 'prices', 'priced', 'pricing', 'amount', 'amounts', 'total', 'totals', 'balance', 'balances'],
  ['pay', 'pays', 'paid', 'paying', 'payment', 'payments', 'settle', 'settles', 'settled', 'settling', 'settlement', 'remit', 'remitted', 'remittance', 'clear', 'cleared', 'clearing'],
  ['budget', 'budgets', 'budgeted', 'budgeting', 'forecast', 'forecasts', 'forecasted', 'forecasting', 'spend', 'spends', 'spent', 'spending', 'expense', 'expenses', 'outlay', 'outlays', 'overhead', 'overheads'],
  ['bank', 'banks', 'banking', 'account', 'accounts', 'transfer', 'transfers', 'transferred', 'transferring', 'deposit', 'deposits', 'deposited', 'depositing', 'withdrawal', 'withdrawals', 'withdraw', 'card', 'cards', 'visa', 'mastercard', 'amex'],
  ['refund', 'refunds', 'refunded', 'refunding', 'credit', 'credits', 'credited', 'crediting', 'rebate', 'rebates', 'reimbursement', 'reimburse', 'reimbursed', 'cashback'],
  ['income', 'incomes', 'revenue', 'revenues', 'turnover', 'takings', 'proceeds', 'wage', 'wages', 'salary', 'salaries', 'paycheque', 'paycheck', 'dividend', 'dividends'],
  ['profit', 'profits', 'profitable', 'loss', 'losses', 'margin', 'margins', 'markup', 'break-even'],
  ['tax', 'taxes', 'taxation', 'gst', 'vat', 'bas', 'deduction', 'deductions', 'deductible', 'accountant', 'accountants', 'bookkeeper', 'bookkeeping'],
  ['debt', 'debts', 'debtor', 'debtors', 'creditor', 'creditors', 'owe', 'owes', 'owed', 'owing', 'overdue'],
  ['quote', 'quotes', 'quoted', 'quoting', 'quotation', 'estimate', 'estimates', 'estimated', 'estimating', 'tender', 'tenders', 'tendered', 'tendering', 'bid', 'bids', 'bidding'],
  ['bill', 'invoice', 'receipt', 'payment', 'budget', 'bank', 'refund', 'income', 'profit', 'tax', 'debt', 'quote', 'money', 'dollars', 'dollar', 'cash', 'finance', 'financial', 'afford', 'affordability', 'expensive', 'cheap', 'costly'],
  ['meeting', 'meetings', 'call', 'calls', 'called', 'calling', 'chat', 'chats', 'chatted', 'chatting', 'discussion', 'discussions', 'catchup', 'catch-up', 'sync', 'syncs', 'briefing', 'briefings', 'workshop', 'workshops', 'session', 'sessions', 'huddle', 'standup', 'stand-up'],
  ['person', 'people', 'team', 'teams', 'staff', 'staffer', 'colleague', 'colleagues', 'coworker', 'coworkers', 'partner', 'partners', 'contact', 'contacts', 'crew', 'member', 'members', 'employee', 'employees'],
  ['manager', 'managers', 'managed', 'managing', 'management', 'lead', 'leads', 'leading', 'leader', 'leaders', 'boss', 'bosses', 'supervisor', 'supervisors', 'supervising', 'director', 'directors', 'owner', 'owners', 'founder', 'founders'],
  ['hire', 'hires', 'hired', 'hiring', 'recruit', 'recruited', 'recruiting', 'recruitment', 'onboard', 'onboarded', 'onboarding', 'interview', 'interviews', 'interviewed', 'interviewing', 'candidate', 'candidates', 'applicant', 'applicants'],
  ['dismiss', 'dismissed', 'dismissing', 'dismissal', 'resign', 'resigned', 'resigning', 'resignation', 'quit', 'quits', 'quitting', 'fired', 'firing', 'notice', 'exited', 'exit'],
  ['email', 'emails', 'emailed', 'emailing', 'mail', 'mails', 'mailed', 'mailing', 'letter', 'letters', 'message', 'messages', 'messaged', 'messaging', 'text', 'texts', 'texted', 'texting', 'sms', 'dm', 'dms'],
  ['phone', 'phones', 'phoned', 'phoning', 'ring', 'rings', 'rang', 'ringing', 'mobile', 'mobiles', 'telephone', 'voicemail'],
  ['project', 'projects', 'plan', 'plans', 'planned', 'planning', 'program', 'programs', 'programme', 'programmes', 'scheme', 'schemes', 'initiative', 'initiatives', 'venture', 'ventures', 'engagement', 'engagements', 'workstream', 'roadmap', 'milestone', 'milestones'],
  ['task', 'tasks', 'todo', 'todos', 'action', 'actions', 'chore', 'chores', 'errand', 'errands', 'followup', 'follow-up', 'assignment', 'assignments', 'next-step'],
  ['start', 'starts', 'started', 'starting', 'begin', 'begins', 'began', 'beginning', 'commence', 'commenced', 'kickoff', 'kick-off', 'launch', 'launches', 'launched', 'launching'],
  ['finish', 'finishes', 'finished', 'finishing', 'complete', 'completes', 'completed', 'completing', 'completion', 'done', 'close', 'closes', 'closed', 'closing', 'closure', 'wrap', 'wraps', 'wrapped', 'wrapping', 'conclude', 'concluded', 'concluding'],
  ['progress', 'progressed', 'progressing', 'advance', 'advances', 'advanced', 'advancing', 'underway', 'ongoing', 'status', 'update', 'updates', 'updated', 'updating'],
  ['risk', 'risks', 'risky', 'issue', 'issues', 'problem', 'problems', 'blocker', 'blockers', 'blocked', 'blocking', 'obstacle', 'obstacles', 'concern', 'concerns', 'worry', 'worries', 'worried', 'worrying'],
  ['decision', 'decisions', 'decide', 'decides', 'decided', 'deciding', 'agree', 'agrees', 'agreed', 'agreeing', 'agreement', 'agreements', 'approve', 'approves', 'approved', 'approving', 'approval', 'signoff', 'sign-off'],
  ['priority', 'priorities', 'prioritise', 'prioritised', 'prioritize', 'prioritized', 'urgent', 'urgency', 'asap', 'important', 'importance', 'critical', 'crucial', 'pressing'],
  ['idea', 'ideas', 'thought', 'thoughts', 'suggestion', 'suggestions', 'suggest', 'suggests', 'suggested', 'suggesting', 'pitch', 'pitches', 'pitched', 'pitching', 'brainstorm'],
  ['note', 'notes', 'noted', 'noting', 'memo', 'memos', 'journal', 'journals', 'log', 'logs', 'logged', 'logging', 'record', 'records', 'recorded', 'recording'],
  ['file', 'files', 'filed', 'filing', 'document', 'documents', 'documented', 'documenting', 'doc', 'docs', 'paper', 'papers', 'paperwork', 'form', 'forms', 'sheet', 'sheets', 'spreadsheet', 'spreadsheets', 'pdf', 'pdfs'],
  ['folder', 'folders', 'directory', 'directories', 'archive', 'archives', 'archived', 'archiving', 'organise', 'organised', 'organize', 'organized', 'sort', 'sorts', 'sorted', 'sorting', 'tidy', 'tidies', 'tidied', 'tidying', 'clean', 'cleans', 'cleaned', 'cleaning'],
  ['search', 'searches', 'searched', 'searching', 'find', 'finds', 'found', 'finding', 'seek', 'seeks', 'seeking', 'sought', 'locate', 'located', 'locating', 'hunt', 'hunts', 'hunted', 'hunting'],
  ['link', 'links', 'linked', 'linking', 'connect', 'connects', 'connected', 'connecting', 'connection', 'connections', 'reference', 'references', 'referenced', 'referencing', 'relate', 'relates', 'related', 'relating', 'relation', 'relations'],
  ['tag', 'tags', 'tagged', 'tagging', 'label', 'labels', 'labelled', 'labeled', 'labelling', 'labeling', 'category', 'categories', 'categorise', 'categorize', 'topic', 'topics'],
  ['template', 'templates', 'format', 'formats', 'layout', 'layouts', 'boilerplate', 'starter', 'starters', 'example', 'examples', 'sample', 'samples'],
  ['backup', 'backups', 'backed-up', 'synced', 'syncing', 'copy', 'copies', 'copied', 'copying', 'duplicate', 'duplicates', 'duplicated', 'duplicating', 'export', 'exports', 'exported', 'exporting', 'import', 'imports', 'imported', 'importing'],
  ['delete', 'deletes', 'deleted', 'deleting', 'deletion', 'remove', 'removes', 'removed', 'removing', 'removal', 'trash', 'trashed', 'bin', 'binned', 'purge', 'purged', 'purging', 'erase', 'erased', 'erasing', 'wipe', 'wiped', 'wiping'],
  ['edit', 'edits', 'edited', 'editing', 'revise', 'revised', 'revising', 'revision', 'revisions', 'amend', 'amended', 'amending', 'amendment', 'correct', 'corrected', 'correcting', 'correction', 'fix', 'fixes', 'fixed', 'fixing'],
  ['house', 'houses', 'home', 'homes', 'property', 'properties', 'mortgage', 'mortgages', 'rent', 'rents', 'rented', 'renting', 'lease', 'leases', 'leased', 'leasing', 'landlord', 'landlords', 'tenant', 'tenants'],
  ['car', 'cars', 'vehicle', 'vehicles', 'drive', 'drives', 'drove', 'driving', 'licence', 'licences', 'license', 'licenses', 'rego', 'registration', 'serviced', 'servicing', 'mechanic', 'mechanics', 'petrol', 'fuel', 'diesel'],
  ['health', 'healthy', 'doctor', 'doctors', 'clinic', 'clinics', 'hospital', 'hospitals', 'medical', 'medicine', 'medicines', 'medication', 'medications', 'prescription', 'prescriptions', 'symptom', 'symptoms', 'diagnosis', 'treatment', 'treatments'],
  ['family', 'families', 'relative', 'relatives', 'parent', 'parents', 'parenting', 'child', 'children', 'kid', 'kids', 'son', 'sons', 'daughter', 'daughters', 'spouse', 'spouses', 'wife', 'wives', 'husband', 'husbands', 'marriage', 'married', 'divorce', 'divorced'],
  ['travel', 'travels', 'travelled', 'traveled', 'travelling', 'traveling', 'trip', 'trips', 'holiday', 'holidays', 'vacation', 'vacations', 'flight', 'flights', 'flying', 'flew', 'hotel', 'hotels', 'accommodation'],
  ['food', 'foods', 'meal', 'meals', 'recipe', 'recipes', 'cook', 'cooks', 'cooked', 'cooking', 'bake', 'bakes', 'baked', 'baking', 'restaurant', 'restaurants', 'cafe', 'cafes', 'dinner', 'dinners', 'lunch', 'lunches', 'breakfast', 'breakfasts', 'grocery', 'groceries'],
  ['goal', 'goals', 'target', 'targets', 'targeted', 'targeting', 'aim', 'aims', 'aimed', 'aiming', 'objective', 'objectives', 'ambition', 'ambitions', 'resolution', 'resolutions', 'habit', 'habits', 'routine', 'routines'],
  ['memory', 'memories', 'remember', 'remembers', 'remembered', 'remembering', 'recall', 'recalls', 'recalled', 'recalling', 'photo', 'photos', 'photograph', 'photographs', 'picture', 'pictures', 'image', 'images', 'video', 'videos'],
  ['business', 'businesses', 'company', 'companies', 'firm', 'firms', 'enterprise', 'enterprises', 'startup', 'startups', 'corporation', 'corporations', 'abn'],
  ['work', 'works', 'worked', 'working', 'job', 'jobs', 'career', 'careers', 'profession', 'professions', 'professional', 'occupation', 'occupations', 'employment', 'employed', 'employer', 'employers'],
  ['sale', 'sales', 'sell', 'sells', 'sold', 'selling', 'deal', 'deals', 'dealing', 'dealt', 'negotiate', 'negotiated', 'negotiating', 'negotiation', 'negotiations', 'upsell', 'cross-sell'],
  ['market', 'markets', 'marketed', 'marketing', 'advertise', 'advertised', 'advertising', 'advertisement', 'campaign', 'campaigns', 'brand', 'brands', 'branded', 'branding', 'promotion', 'promotions', 'promote', 'promoted', 'promoting'],
  ['website', 'websites', 'site', 'sites', 'webpage', 'online', 'internet', 'web', 'domain', 'domains', 'hosting', 'hosted'],
  ['software', 'app', 'apps', 'application', 'applications', 'tool', 'tools', 'platform', 'platforms', 'system', 'systems', 'service', 'services', 'feature', 'features', 'bug', 'bugs'],
  ['report', 'reports', 'reported', 'reporting', 'summary', 'summaries', 'summarise', 'summarised', 'summarize', 'summarized', 'overview', 'overviews', 'brief', 'briefs', 'briefed', 'digest', 'digests'],
  ['contract', 'contracts', 'contracted', 'contracting', 'terms', 'condition', 'conditions', 'clause', 'clauses', 'sign', 'signs', 'signed', 'signing', 'signature', 'signatures', 'legal', 'lawyer', 'lawyers', 'solicitor', 'solicitors'],
  ['today', 'tonight', 'tomorrow', 'yesterday', 'morning', 'mornings', 'afternoon', 'afternoons', 'evening', 'evenings', 'night', 'nights', 'noon', 'midnight'],
  ['week', 'weeks', 'weekly', 'fortnight', 'fortnights', 'fortnightly', 'month', 'months', 'monthly', 'quarter', 'quarters', 'quarterly', 'year', 'years', 'yearly', 'annual', 'annually'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'weekend', 'weekends', 'weekday', 'weekdays'],
  ['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['calendar', 'calendars', 'appointment', 'appointments', 'event', 'events', 'invite', 'invites', 'invited', 'inviting', 'rsvp'],
  ['remind', 'reminds', 'reminded', 'reminding', 'reminder', 'reminders', 'alert', 'alerts', 'alerted', 'alerting', 'notify', 'notified', 'notifying', 'notification', 'notifications', 'nudge', 'nudges', 'nudged', 'nudging', 'ping', 'pings', 'pinged'],
  ['wait', 'waits', 'waited', 'waiting', 'pending', 'pause', 'pauses', 'paused', 'pausing', 'hold', 'holds', 'held', 'holding', 'stall', 'stalled', 'stalling', 'stuck'],
  ['cancel', 'cancels', 'cancelled', 'canceled', 'cancelling', 'canceling', 'cancellation', 'reschedule', 'rescheduled', 'rescheduling'],
  ['ask', 'asks', 'asked', 'asking', 'question', 'questions', 'questioned', 'questioning', 'query', 'queries', 'queried', 'querying', 'wonder', 'wonders', 'wondered', 'wondering', 'clarify', 'clarified', 'clarification'],
  ['answer', 'answers', 'answered', 'answering', 'reply', 'replies', 'replied', 'replying', 'respond', 'responds', 'responded', 'responding', 'response', 'responses'],
  ['thank', 'thanks', 'thanked', 'thanking', 'grateful', 'gratitude', 'appreciate', 'appreciates', 'appreciated', 'appreciating', 'appreciation'],
  ['sorry', 'apologies', 'apologise', 'apologised', 'apologize', 'apologized', 'apology', 'excuse', 'excuses', 'regret', 'regrets', 'regretted', 'regretting'],
  ['big', 'bigger', 'biggest', 'large', 'larger', 'largest', 'huge', 'enormous', 'massive', 'small', 'smaller', 'smallest', 'little', 'tiny'],
  ['good', 'better', 'best', 'great', 'greater', 'greatest', 'excellent', 'superb', 'fantastic', 'wonderful', 'awesome', 'brilliant', 'bad', 'worse', 'worst', 'terrible', 'awful', 'horrible', 'poor'],
  ['novel', 'fresh', 'ancient', 'outdated', 'obsolete', 'deprecated', 'legacy'],
  ['fast', 'faster', 'fastest', 'quick', 'quicker', 'quickest', 'rapid', 'rapidly', 'speedy', 'speedily', 'swift', 'swiftly'],
  ['easy', 'easier', 'easiest', 'simple', 'simpler', 'simplest', 'straightforward', 'hard', 'harder', 'hardest', 'difficult', 'difficulty', 'complex', 'complicated', 'tricky'],
  ['clear', 'clearer', 'clearest', 'obvious', 'obviously', 'plain', 'plainly', 'unclear', 'confusing', 'confused', 'confusion', 'vague', 'vaguely', 'ambiguous'],
  ['sure', 'surely', 'certain', 'certainly', 'confident', 'confidently', 'unsure', 'uncertain', 'uncertainly', 'maybe', 'perhaps', 'possibly', 'probably', 'likely', 'unlikely'],
  ['want', 'wants', 'wanted', 'wanting', 'need', 'needs', 'needed', 'needing', 'require', 'requires', 'required', 'requiring', 'requirement', 'requirements'],
  ['able', 'unable', 'ability', 'capable', 'capability', 'possible', 'possibility', 'impossible', 'cannot'],
  ['know', 'knows', 'knew', 'knowing', 'known', 'knowledge', 'understand', 'understands', 'understood', 'understanding', 'learn', 'learns', 'learned', 'learning', 'realise', 'realised', 'realize', 'realized', 'aware', 'awareness'],
  ['think', 'thinks', 'thought', 'thinking', 'believe', 'believes', 'believed', 'believing', 'belief', 'beliefs', 'feel', 'feels', 'felt', 'feeling', 'feelings', 'consider', 'considers', 'considered', 'considering', 'reckon', 'reckons', 'reckoned'],
  ['say', 'says', 'said', 'saying', 'tell', 'tells', 'told', 'telling', 'speak', 'speaks', 'spoke', 'speaking', 'talk', 'talks', 'talked', 'talking', 'mention', 'mentions', 'mentioned', 'mentioning', 'state', 'states', 'stated', 'stating'],
  ['show', 'shows', 'showed', 'shown', 'showing', 'display', 'displays', 'displayed', 'displaying', 'demonstrate', 'demonstrates', 'demonstrated', 'demonstrating', 'demo', 'demos', 'present', 'presents', 'presented', 'presenting', 'presentation'],
  ['give', 'gives', 'gave', 'given', 'giving', 'provide', 'provides', 'provided', 'providing', 'provision', 'offer', 'offers', 'offered', 'offering'],
  ['use', 'uses', 'used', 'using', 'usage', 'utilise', 'utilised', 'utilize', 'utilized', 'apply', 'applies', 'applied', 'applying', 'employ', 'employs', 'employed', 'employing'],
  ['help', 'helps', 'helped', 'helping', 'helpful', 'assist', 'assists', 'assisted', 'assisting', 'assistance', 'support', 'supports', 'supported', 'supporting'],
  ['try', 'tries', 'tried', 'trying', 'attempt', 'attempts', 'attempted', 'attempting', 'effort', 'efforts'],
  ['arrive', 'arrives', 'arrived', 'arriving', 'arrival', 'arrivals', 'reach', 'reaches', 'reached', 'reaching', 'turn-up', 'show-up'],
  ['send', 'sends', 'sent', 'sending', 'ship', 'ships', 'shipped', 'shipping', 'deliver', 'delivers', 'delivered', 'delivering'],
  ['receive', 'receives', 'received', 'receiving', 'receipt', 'get-in', 'collect', 'collects', 'collected', 'collecting', 'pick-up', 'pickup'],
  ['exercise', 'exercises', 'exercised', 'exercising', 'workout', 'workouts', 'gym', 'run', 'runs', 'ran', 'running', 'walk', 'walks', 'walked', 'walking', 'swim', 'swims', 'swimming', 'yoga'],
  ['sleep', 'sleeps', 'slept', 'sleeping', 'rest', 'rests', 'rested', 'resting', 'nap', 'naps', 'napping', 'tired', 'tiredness', 'fatigue', 'fatigued', 'energetic', 'energy'],
  ['publish', 'publishes', 'published', 'publishing', 'publication', 'publications', 'edition', 'editions', 'article', 'articles', 'post', 'posts', 'posted', 'posting', 'blog', 'blogs', 'newsletter', 'newsletters'],
  ['write', 'writes', 'wrote', 'written', 'writing', 'writer', 'writers', 'author', 'authors', 'authored', 'authoring', 'draft', 'drafts', 'drafted', 'drafting', 'proofread'],
  ['read', 'reads', 'reading', 'reader', 'readers', 'book', 'books', 'ebook', 'ebooks', 'novel', 'novels', 'chapter', 'chapters', 'page', 'pages'],
  ['listen', 'listens', 'listened', 'listening', 'hear', 'hears', 'heard', 'hearing', 'sound', 'sounds', 'audio', 'podcast', 'podcasts', 'music', 'song', 'songs'],
  ['code', 'codes', 'coded', 'coding', 'script', 'scripts', 'scripted', 'scripting', 'develop', 'develops', 'developed', 'developing', 'developer', 'developers', 'development', 'build', 'builds', 'built', 'building', 'deploy', 'deployed', 'deploying', 'release', 'releases', 'released', 'releasing'],
  ['test', 'tests', 'tested', 'testing', 'verify', 'verifies', 'verified', 'verifying', 'validate', 'validates', 'validated', 'validating', 'pass', 'passes', 'passed', 'passing', 'fail', 'fails', 'failed', 'failing', 'failure', 'failures'],
  ['design', 'designs', 'designed', 'designing', 'designer', 'designers', 'mockup', 'mockups', 'wireframe', 'wireframes', 'prototype', 'prototypes', 'prototyped', 'prototyping'],
  ['asset', 'assets', 'logo', 'logos', 'font', 'fonts', 'colour', 'colours', 'color', 'colors', 'palette', 'palettes', 'style', 'styles', 'guideline', 'guidelines'],
  ['automation', 'automations', 'automate', 'automates', 'automated', 'automating', 'workflow', 'workflows', 'flow', 'flows', 'trigger', 'triggers', 'triggered', 'triggering'],
  ['skill', 'skills', 'skilled', 'agent', 'agents', 'agentic', 'bot', 'bots', 'chatbot', 'chatbots', 'assistant', 'assistants', 'model', 'models', 'prompt', 'prompts', 'prompted', 'prompting'],
  ['voice', 'voices', 'dictate', 'dictates', 'dictated', 'dictating', 'dictation', 'transcribe', 'transcribed', 'transcribing', 'transcript', 'transcripts', 'transcription'],
  ['map', 'maps', 'mapped', 'mapping', 'location', 'locations', 'place', 'places', 'address', 'addresses', 'suburb', 'suburbs', 'city', 'cities', 'country', 'countries', 'postcode'],
];

/** Phrases that read as their idea ("on time" is punctual, whenever the words sit together). */
const PHRASES: readonly (readonly [string, readonly string[]])[] = [
  ['delivery date', ['deadline']], ['delivery dates', ['deadline']], ['due date', ['deadline', 'due']], ['due dates', ['deadline', 'due']],
  ['on time', ['punctual']], ['in time', ['punctual']], ['held up', ['late', 'delay']], ['hold up', ['late', 'delay']],
  ['behind schedule', ['late', 'overdue']], ['missed deadline', ['late', 'overdue']], ['third time', ['again', 'repeated']],
  ['second time', ['again', 'repeated']], ['all the time', ['always', 'often']], ['every time', ['always', 'often']],
  ['bank transfer', ['transfer', 'bank']], ['direct debit', ['transfer']], ['credit card', ['card', 'bank']], ['debit card', ['card', 'bank']],
  ['to do', ['task', 'todo']], ['follow up', ['followup', 'task']], ['catch up', ['meeting', 'progress']], ['stand up', ['meeting']],
  ['one on one', ['meeting']], ['point of sale', ['pos']], ['end of day', ['eod']],
];

const conceptOf = new Map<string, number[]>();
CONCEPTS.forEach((group, id) => {
  for (const word of group) for (const form of new Set([word, stem(word)])) {
    const list = conceptOf.get(form);
    if (list) { if (!list.includes(id)) list.push(id); } else conceptOf.set(form, [id]);
  }
});
const phraseOf = new Map<string, readonly string[]>();
for (const [phrase, words] of PHRASES) phraseOf.set(phrase, words);

/** A text's ideas and words with how often each appears. */
export interface MeaningBag {
  concepts: Map<number, number>;
  words: Map<string, number>;
}

/** A text's ideas: phrases folded in, stopwords out, each word's ideas plus its stem. */
export function meaningWords(text: string): MeaningBag {
  const concepts = new Map<number, number>();
  const words = new Map<string, number>();
  const raw = (foldDiacritics(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2);
  const extra: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tri = i + 2 < raw.length ? `${raw[i]} ${raw[i + 1]} ${raw[i + 2]}` : '';
    const bi = i + 1 < raw.length ? `${raw[i]} ${raw[i + 1]}` : '';
    const hit = (tri && phraseOf.get(tri)) || (bi && phraseOf.get(bi));
    if (hit) extra.push(...hit);
  }
  for (const w of [...raw.filter((x) => !STOP_MEANING.has(x)), ...extra]) {
    const s = stem(w);
    const ids = conceptOf.get(w) ?? conceptOf.get(s);
    if (ids) for (const id of ids) concepts.set(id, (concepts.get(id) ?? 0) + 1);
    words.set(s, (words.get(s) ?? 0) + 1);
  }
  return { concepts, words };
}

const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

/** A bag's hashed vector, normalised: ideas full weight, bare words a share (paraphrase still meets). */
export function vectorFromMeaning(bag: MeaningBag): number[] {
  const vec = new Array<number>(MEANING_DIM).fill(0);
  for (const [id, n] of bag.concepts) vec[hash(`c${id}`) % MEANING_DIM] += 1 + Math.log(n);
  for (const [word, n] of bag.words) vec[hash(`w${word}`) % MEANING_DIM] += WORD_SHARE * (1 + Math.log(n));
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** A text's meaning vector in one call (the index hashes title twice itself). */
export function vectorForText(text: string): number[] {
  return vectorFromMeaning(meaningWords(text));
}

// Two vectors' likeness lives in ./vectors now (p12-task-writes round 2: the write check's plugin bundle),
// re-exported so its readers move nowhere.
export { cosine } from './vectors';

/** How many ideas two bags share (the coverage gate on hashed meaning hits: the query and the note). */
export function sharedConcepts(a: MeaningBag, b: MeaningBag): number {
  let n = 0;
  for (const id of a.concepts.keys()) if (b.concepts.has(id)) n++;
  return n;
}

/** Plain words only gain meaning hits: operators, phrases, patterns and exclusions keep word-only behaviour. */
export function isMeaningQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < 2 || /[:()"/[\]]/.test(q) || /(^|\s)-\S/.test(q) || /\sOR\s/.test(q)) return false;
  const bag = meaningWords(q);
  return bag.concepts.size > 0 || bag.words.size > 0;
}

/** How much a line shares with a query's ideas (for a meaning hit's preview lines). */
export function lineScore(line: string, query: MeaningBag): number {
  const bag = meaningWords(line);
  if (!bag.concepts.size && !bag.words.size) return 0;
  let score = 0;
  for (const [id, n] of bag.concepts) score += Math.min(n, query.concepts.get(id) ?? 0);
  for (const [word, n] of bag.words) score += WORD_SHARE * Math.min(n, query.words.get(word) ?? 0);
  return score;
}

/** A long note in pieces for the on-device model: split by heading and paragraph (a heading stays with what it
 *  heads), each piece short enough to embed whole, the opening first, at most EMBED_MAX_CHUNKS. Short notes come back
 *  as the one piece they are. Pure: the embedder (src/main/meaning-embed.ts) adds the title to each piece. */
export function chunkNote(content: string, maxChunks = EMBED_MAX_CHUNKS): string[] {
  const paras: { text: string; headed: boolean }[] = [];
  let cur: string[] = [];
  const flush = () => {
    const text = cur.join('\n').trim();
    const headed = cur.length > 0 && /^#{1,6}\s/.test(cur[0].trim());
    cur = [];
    if (text) paras.push({ text, headed });
  };
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    // A heading starts a new piece (it stays, with what it heads, below).
    if (/^#{1,6}\s/.test(line.trim()) && cur.length) flush();
    cur.push(line);
  }
  flush();
  if (!paras.length) return [];
  // Small paragraphs join up (fewer model runs); a headed paragraph always starts a piece, long ones stand alone.
  // ~1,200 characters stays under 256 tokens for prose, with room for the title the embedder adds.
  const chunks: string[] = [];
  let at = '';
  for (const p of paras) {
    if (!p.headed && at && `${at}\n\n${p.text}`.length <= 1200) {
      at = `${at}\n\n${p.text}`;
      continue;
    }
    if (at) chunks.push(at);
    at = p.text;
  }
  if (at) chunks.push(at);
  return chunks.slice(0, Math.max(1, maxChunks));
}

/** A note's best lines for a query's ideas: most shared ideas first, prose before fenced code. The body only is
 *  scored (break-it finding 5, 6 Nov 2026: raw property lines such as `speakers:` showed as the snippet), the
 *  same body `openingLines` previews and the reranker's `confirmText` reads, with the note's own line numbers. */
export function bestLines(content: string, query: MeaningBag, max = 2): { line: number; text: string }[] {
  const lines = content.split(/\r?\n/);
  let bodyFrom = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(l));
    if (close > 0) bodyFrom = close + 1;
  }
  const found: { line: number; text: string; score: number; fenced: boolean }[] = [];
  let fence = false;
  lines.forEach((text, line) => {
    if (line < bodyFrom) return;
    if (/^(```|~~~)/.test(text.trim())) fence = !fence;
    if (!text.trim()) return;
    const score = lineScore(text, query);
    if (score > 0) found.push({ line, text, score, fenced: fence });
  });
  found.sort((a, b) => Number(a.fenced) - Number(b.fenced) || b.score - a.score || a.line - b.line);
  return found.slice(0, Math.max(0, max)).map(({ line, text }) => ({ line, text }));
}
