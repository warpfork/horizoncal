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


Status
------

HorizonCal is under active development, but usable.

Your humble primary author is at a dogfooding level of usage and considers this a daily-driver.
The level of polish for others may be a bit rough :)

Core features are working:

- Create events by selecting time blocks in the GUI.
- Edit events with Horizoncal's modal forms (which do validation) or by editing the files raw.
- Dragging and dropping events in the UI automatically edits files, and changes in files immediately update the UI.
- Synchronizing everything with the usual plain-files sync tools absolutely works!
- Events can be assigned to categories; this updates their colors, etc.

A few more advanced features are still in-progress:

- Categories can be user-defined... but the settings dialog for this is not yet implemented; you'd have to edit `data.json` manually.
- "tzch" events are planned, but not yet implemented :)  (Timezones *are* otherwise already robustly well-supported, though.)

**Installing and using this plugin currently requires building from source.**
You can find some pointers in the [HACKME](hack/HACKME.md) file.
We'll aim to publish to the Obsidian community plugins store in the future...
but for now, this is for people who aren't afraid of compilers :)


Data Format
-----------

HorizonCal uses one file per event, and Obsidian frontmatter to store almost all data.

The file layout is roughly "`{hc_dir}/{YYYY}/{MM}/{DD}/evt-{YYYY}-{MM}-{DD}-{evt_title}-{uid}`".

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
- HorizonCal cares about being _Fast_, even with large numbers of events over large spans of time.  This also weighted heavily in favor of a file-per-event approach, because being fast means means we need to lay things out in a way that's easy for us to index over.  (For example, we use certain filename conventions to quickly mark files with data that needs to be read across large timespans (like your timezone shift events!  A thing we support, by the way!) so they can be found quickly without parsing every other event in your repo to discover them.)  A file-per-event also means we're not stuck parsing through the rest of your daily notes file contents while looking for the subset of data that's relevant to us.
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

HorizonCal uses primarily named timezones.

(In hacking details: HorizonCal internally ends up using offsets...
but generally not directly in the user's sight; it's a detail of how some of our libraries work.)

HorizonCal does not store the offsets that named timezones are resolved to, nor any unix timestamps.
In most cases, this is not comment worthy.  In the (relatively rare) case that the TZDB is changed,
due to adventurous human policy changes, this may mean some future events you've scheduled change
in which exact second they resolve to.  This is generally... fine.
This is a calendar for humans, not for log event linearization.
If a TZDB change happens... then accepting it _is probably right_.

You can read more about how exactly these are stored in your event data files in the [HACKME document](hack/HACKME.md).

### What if I create events without timezones?

HorizonCal will add the current prevailing timezone as soon as it has any encounter at all with that event file.


Integrating with other Calendars
--------------------------------

The primary goals of HorizonCal are to be a good calendar that is _local first_,
so our support for other cloud-based calendars will always be second class.

At the moment, there's not much support for other calendars.

If you're interested in hacking on this, PRs may be accepted,
and you might find it interesting to know the fullcalendar library already has some useful support:

- reading ical is easily supported: https://fullcalendar.io/docs/icalendar
- google calendar also has specific support: https://fullcalendar.io/docs/google-calendar

It's possible that these features will be easy to add!
However, the primary author of this plugin doesn't need any of them,
and has no calendars of thoes types to test on,
so... this is "PRs welcome" :)

Maybe the person to add these features can be you!


License
-------

SPDX-License-Identifier: Apache-2.0 OR MIT
