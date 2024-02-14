HorizonCal -- a Calendar and Event plugin for Obsidian
======================================================

HorizonCal is an calendar application that stores data in an Obsidian-native way --
plain files!  Syncing naturally with the rest of your Obsidian repo --
and offers a rich and editable view (powered by the venerable FullCalendar library).

Features include:

- the basics you expect from a calendar -- month views, daily and weekly time grid views, etc.
- adjustable timegrid sizes!  Want to look forward at an hourly scale for two weeks?  Can do!
- attach rich notes to any event -- they're all just Obsidian notes, after all!
- quick add events with a modal form -- trigger this as a command from anywhere to add new events rapidly.
- drag-and-drop edit of event times!
- easy query from other plugins -- all data is in frontmatter, so using Dataview, etc, is easy!
  - (future plan: `hc` should expose a `.dvevents(start,end)` helper that returns a DV DataArray with all the pathing pre-handled for your convenience.)
- rich support for timezones!  Create special events to tell the calendar when your personal timezone is changing, so the calendar can automatically adapt views and new event creation to seamlessly project events in to _your contextually relevant time_ for _you_ -- even when you look forward or backward over timezone changes.  (Yeah, I travel a lot.  How could you tell? :))


Data Format
-----------

HorizonCal uses one file per event, and Obsidian frontmatter to store almost all data.

The file layout is roughly "`{hc_dir}/{YYYY}/{MM}/evt-{YYYY}-{MM}-{DD}-{evt_title}-{uid}`".

(Files are renamed when the event date or title changes.)

There are a couple additional files that use a slightly different convention.
For example, some filenames start with "`tzch-`" instead of "`evt-`" -- these are timezone change events.
(We give these different name patterns because we usually need to load them from wider ranges of dates.)


### HorizonCal's format is opiniated

HorizonCal has chosen to have one specific format of its own for event storage.
(This is admittedly in contrast to a lot of Obsidian plugins, which are a bit "have it your way".)
HorizonCal made specific choices about both the filesystem layout, and the property names and their formats that are used in each event file.

There's a couple of reasons that drove the choices we made:

- HorizonCal is meant to be editable by drag-and-drop!  This weighed heavily in favor of a file-per-event approach, because our intent to be able to edit the data a _lot_, programmatically, means it might as well be in a machine-friendly format (and especially, not embedded in the middle of your other human-written freetext, which would be harder to preserve cleanly... especially if we move events between whole days).
- HorizonCal cares about being _Fast_, even with large numbers of events over large spans of time.  This also weighted heavily in favor of a file-er-event approach, because being fast means means we need to lay things out in a way that's easy for us to index over.  (For example, we use certain filename conventions to quickly mark files with data that needs to be read across large timespans (like your timezone shift events!  A thing we support, by the way!) so they can be found quickly without parsing every other event in your repo to discover them.)  A file-per-event also means we're not stuck parsing through the rest of your daily notes file contents while looking for the subset of data that's relevant to us.
- HorizonCal cares about working with large numbers of events.  This means we insist on using directories to organize years and months.  (You don't want to end up with a directory with 20,000 entries in it that lags the UI if you accidentally open it in a folder nav tree, do you?)
- Consistency is good for everyone!  It would be delightful if all HorizonCal users can also share their own dataview query snippets, and having a basic agreement on the file layout conventions makes them work reliably (and efficiently) for everyone, without the need to tweak.
- HorizonCal keeps dates, times in the day, and timezone data each in their own fields in each file.  We chose this approach based on a study of how Obsdian's native properties editor interacts with these fields.  We want the approach that derives the most value from Obsidian's built-in property editor, while also being the least likely to experience accidental data loss where Obsidian's property editor rounds some corners.  (Timezones, especially, do not survive in Obsidian's "Date & Time" property, and so forced separate fields.)  This does result in quite a few properties, but stability and clarity is worth it.

In short: We chose a format and a file layout pattern that we think supports clarity, large scale usage, and consistent organization well,
and we think that's a good choice to make upfront on behalf of our users.

You can read more about some of the exact details of choices in the [HACKME document](hack/HACKME.md).


### Filename and Date handling errata

The date fields used: are the event's _start_ date... as the date would be for the timezone of the start event.
(Yes, this does mean changing the timezone of an event could cause it to be renamed!  But I find overall this generally "DWIM".  Using UTC dates would be significantly more confusing in practice.)

If you're writing your own queries against HorizonCal events: you probably want to include a range of folders one day _wider_ than your actual target, so that you can gather and parse any 


Timezones
---------

HorizonCal puts a lot of effort into supporting timezones in a complete but humane way.

Instead of assuming the system timezone is always relevant, and _only_ letting you switch your _current_ view,
HorizonCal lets you _specify when you'll switch timezones_.

If you're a frequent traveller, you'll immediately understand why this is important :)

Since HorizonCal lets you _tell_ your calendar when your timezone changes...

- when you create new events that are after a timezone shift, you can create them in the "local" time _considering that shift_, and HorizonCal with do the right thing.
- when you scroll back across previous dates, HorizonCal will prompt you to switch to the relevant time that was local to you _then_ -- so even if you're in a different place and timezone now, the view for those dates is _what made sense on those dates_.

Otherwise, things are pretty standard:

- All events have a timezone stored.
- You can edit this manually, if you want (you'll have to dive into the Obsidian frontmatter manually to do this, though).
- You can have events with distinct start and end timezones!
- When editing events by drag-n-drop in the calendar view, whatever the timezones were, is retained.

We hope this behavior pleases :)  Timezones are definitely hard to handle well, but we hope this hits close to the mark.

### Named timezones, or +offset timezones?

HorizonCal uses _both_.

- Users (typically) specify named timezones.
- Events store the offset form as well, for stability.
- HorizonCal generates the offset form and updates it when events are moved.

The main reason to do things this way is to interact correctly with changes like Daylight Savings Time transitions.
This requires named timezones.  (The timezone "Europe/Berlin" transitions between "CET" and "CEST" over course of the year!)

At the same time, we store offset literals, because they're clearer and more stable.
Name timezones have one major drawback: they're more complex because they have to be _resolved_ into an offset,
and those definitions can change over time!
(This year, "Europe/Berlin" has those daylight savings time transitions -- will it next year?  Who knows!
That's a human policy decision, and it may change!)
((REVIEW: I'm not actually sure this is sanely justifiable.  Yes, the TZDB changes.  But other humans are pretty good at making sure it doesn't change retroactively.  Worst case?  Some events get mapped to different unix epoch timestamps?  _oh no_.  This is a calendar for humans, not for log event linearization -- if that happens, _it's probably right_.)

You can read more about how exactly these are stored in your event data files in the [HACKME document](hack/HACKME.md).

### What if I create events without timezones?

HorizonCal will add the current prevailing timezone as soon as it has any encounter at all with that event file.
