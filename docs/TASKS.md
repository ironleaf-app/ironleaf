# Tasks in Ironleaf

A task is any tick-box line in a note. Ironleaf gathers every one of them, open and done, into the Tasks view
(the side bar's Tasks, or "Open Tasks" in the command list). Nothing is kept anywhere but the notes themselves.

## Writing a task

```
- [ ] Send the quote to [[Sam Okafor]] #work 📅 2026-10-24
- [ ] Ring the mill 📅 2026-10-24 15:00
- [x] Book the van
```

- `- [ ]` is open; `- [x]` is done (`[-]` and other marks count as done too).
- `#tags` on the line are the task's own tags; the note's tags count for its tasks as well.
- A link to a People note (`[[Sam Okafor]]`, or `@Sam` which writes the link) names the person the task is for.
- A task belongs to the project its note belongs to (the project's folder, or a `project:` property naming it). A
  project's own next steps are tasks of that project.

## The due day: one plain way

Ironleaf writes a due day as **`📅 YYYY-MM-DD`**, and with a time as **`📅 YYYY-MM-DD HH:MM`** (24-hour). The Tasks
view's calendar button writes it for you, so you never need to type the mark.

Other ways people and other apps write it are read too, so imported notes just work:

| Written | Read as |
| --- | --- |
| `due:: 2026-10-24`, `[due:: 2026-10-24]`, `due:2026-10-24` | 24 Oct 2026 |
| `@due(2026-10-24 15:00)` | 24 Oct 2026 at 3 pm |
| `— by 24 Oct 2026`, `(due Fri 24 Oct)`, `— by 24 Oct 2026 at 3pm` | 24 Oct 2026 (at 3 pm) |
| `[[2026-10-24]]` (a link to the day's note) | 24 Oct 2026 (the link stays in the words) |
| `⏰ 2026-10-24 09:00` (a reminder) | 24 Oct 2026 at 9 am |

Words like "by Friday" are not read as a day: written on some earlier day, they no longer say which Friday.

Marks other apps add — done (`✅ 2026-10-20`), scheduled (`⏳`), start (`🛫`), made (`➕`), cancelled (`❌`), priority
(`🔺 ⏫ 🔼 🔽 ⏬`) and repeats (`🔁 every week`) — are kept in the note but left out of the words shown.

## Filters

- **Open / Done / All.**
- **When:** Any time, Today, Overdue (open and its day has passed), This week (Monday to Sunday of the week today is in),
  No date.
- **Project, Person, Tag** (a tag keeps the tags below it: `#work` keeps `#work/clients`), and words to find.
- **Order:** by due day (soonest first, then by time; no date last), by note, or the notes changed lately first.

## Ticking, days and reminders

- The box ticks the task in its note (with Undo). A repeating reminder ticked moves on to its next time.
- The calendar button sets the day (Today, Tomorrow, Next Monday, In a week, or any day), adds a time, or takes the day
  off, always in the one plain way above.
- A task with a day can become a reminder: its due mark becomes the reminders' own `⏰ 2026-10-24 15:00` (9:00 am when no
  time was written), and Ironleaf reminds you then.
- Overdue tasks and the ones due today and this week show on Today under Due.
