HACKME notes for HorizonCal
===========================

This file is for a developer-centric point of view!
You probably want to read the [README](../README.md) instead (and definitely read it _first_).

If you're still looking for more details, and don't mind seeing code and raw data, carry on :)

---

HC's approach to Dates
----------------------

Handling dates programmatically is an adventure.

### Dates have many formats

There are *many* different formats you'll see, both in data at rest,
and in javascript, even more:

- Strings of "YYYY-MM-DD" -- a subset of ISO8601.
- Strings of "YYYY-MM-DDTHH:mm" -- ISO8601 with some hours and minutes.
- Strings of "YYYY-MM-DDTHH:mm:ss+XX:xx" -- ISO8601 now with seconds and timezone offsets!
- Strings of timezone names, like "Europe/Berlin" (not possible in ISO8601 strings; have a different purpose than TZ offset numerics!).
- Strings of "HH:mm" or "hh:mm a", depending on the user's preference for 12 or 24 hour sytems.
- Javascript data in objects like `{year: 2024, month: 12, day: 31}` and `{hours:14}`.
- Javascript's native `Date` type.
- Javascript's Luxon libraries -- has `DateTime` and `Duration` types.
- Javascript's Moment libraries.
- And of course, unix time integers will pop up if you look hard enough at anything.
- ... and probably more forms as well.

ALL OF THESE are seen in Obsidian, and it is MINDBOGGLING.

(Obsidian itself prefers Moment;
the popular Dataview plugin prefers Luxon;
the FullCalendar library we use for our own rendering uses Javascript's native `Date`;
and most of Obsidian's saved data uses ISO8601 strings (but discards TZ offsets!).
So it's literally everything; the full gammut.  Whee!)

### _So what does HorizonCal do?_

We don't.  In as much as possible, anyway.

We keep things as strings as much as possible, and mostly use Luxon if we really need to get programmatic.
But we stay in strings whenever we can, because that's seems to be a clearer "ground truth" than anything else.

We use the ISO8601 string format for dates -- "YYYY-MM-DD"...

And we usually store the "HH:mm" part separately.
(This is mostly because of Obsidian UI reasons, and two of them:
first, if Obsidian sees a property as a 'Date & Time' type, *it doesn't let you skip the time component*,
which is problematic for us (all-day events don't have a time component, thank you very much);
second: Obsidian creates clickable links to daily notes files when a something is a date, but not when it's a date&time... and I like that link!)

We store timezones separately.
This isn't so much a choice as a necessity:
ISO8601 strings can't describe named timezones, and we need those (mostly for DST handling reasons), so we need another field for them.
(Even if named timezones could be stored in the same string, there's another problem:
Obsidian's property editor drops timezone offsets unceremoniously (! yikes).)

And then we try very hard to not have HorizonCal actually store any data at all in memory.
There's the source-of-truth on the filesystem;
there's what the FullCalendar library is holding onto for rendering;
and we don't need to make things complex by adding a third source of truth.
FullCalendar events are pretty good at reporting both the original date and the change of date,
which gives us plenty of information to kick off the change in the original file,
and then pretty much reload everything through the whole flow again, in glorious unidirectional simplicity.

### Dataview complicates this

Dataview automatically parses dates into Luxon DateTime objects.

... which includes assuming they're in the system default timezone.  Whoops.

So, whenever we look at that data, we have to be careful to take the raw year, month, and day values out.
Setting the timezone and _shifting_ the data would be incorrect.

If we validated things more aggressively, we'd probably also want to look a second time at the _raw_ data
and make sure it doesn't contain _more_ resolution (hours, minutes) than we're expecting in that field.
Currently, we don't do this... so if the user edits things in that way, the data would be silently ignored.
This seems okay, because it's what the Obsidian properties editor will guide user flow towards anyway.

---

HC's file tree layout
---------------------

Basically, I ballpark the number of events per year to consider as about 6000.
That's 500 a month, or on average about 16 a day.

(For some users, it's not anywhere near this number; for others, it might be _more_.
If you use the calendar as a pomodoro log, you'll probably get _much_ more than 16 events a day!)

So with that in mind:

- a directory per year: definitely.  I think this doesn't even need argument.
- a directory per month: yes, I think so.  My hottake is that a directory with more than a thousand files in it is just kinda a bad idea, and so that means a yearly dir isn't enough.
- a directory per day: this one's disputable.
  - For the heaviest users, who _also_ inspect things in the file browser frequently, this might be organizationally useful.  But that's going to be a very small set of users.  My guess is that most users probably just won't care.
  - There's no hard scalability reason to make this many subdirectories.  (Popping open a dir with a few hundred files shouldn't lag any reasonable interface or process.)
  - There's no hard scalability reason _not_ to make daily dirs either, though.  (For a user with only one event per day, a whopping 365 inodes get wasted per year on dirs with one file?  _oh no_.  Yeah, I think it'll be fine.)

We repeat the full date in each filename, because that seems to be a useful disambiguator in the case of any other integrations or UIs that don't show paths leading up to a file.

(And then yes, the date is repeated *in* the file contents.  Uufdah!  But, this is where we expect it to be edited.
HC will update file paths to match the content in the file.)

### Atomicity

TODO this might be rough.  I'd like to patch frontmatter, change the path, and have obsidian do any link rewrites... all in one transaction.  I suspect that's probably not feasible :)

In case of ambiguity, the order of operations is: patch frontmatter first; then move files.
This means it's always correct to update file paths if there's a desync.
