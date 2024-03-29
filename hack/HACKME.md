HACKME notes for HorizonCal
===========================

This file is for a developer-centric point of view!
You probably want to read the [README](../README.md) instead (and definitely read it _first_).

If you're still looking for more details, and don't mind seeing code and raw data, carry on :)

---

Hacking on an Obsidian Plugin
-----------------------------

- Mostly:
	- clone this into `yourvault/.obsidian/plugins/horizoncal`, and run `npm run dev`.
	- See https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin !
	- You'll probably also want the Hot Reload psuedo-plugin mentioned in that link.

And you'll be off to the races in no time.

Some other misc details:

- you should occasionally run `npm run build` just to make sure it still works.  (It lints even more aggressively.)


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

HC's file tree layout is designed around four concerns:

1. legibility.
2. integration with obsidian.
3. scale.
4. stability (i.e. for version control and diffing).

These ultimately lead us to a format that's roughly:

```
horizoncal/{YYYY}/{MM}/{DD}/evt-{YYYY}-{MM}-{DD}-{event_title}.md
```

### Files and legibility

"Legibility" is pretty straightforward: I think data should be in files,
and the files should be organized per date.
If there's more than one file per date (and the other constraints are going to push us that way),
then the filenames should try to use relevant metadata from their content to have meaningful names.

(It's not a problem to repeat a subset of the metadata in the filename,
as long as we make the tool good at keeping it in sync in a pleasantly automatic way.
And we will: see the later sections on atomicity and when things update.)

### Files and Obsidian

Obsidian has a very nice built-in properties editor for the frontmatter in files.
That even includes things like date picker widgets, which do platform native things on mobile, and so on.
That's pretty nice!  We want to use all this as much as possible.

We also want attaching arbitrarily large amounts of freetext notes to any event to be easy.

Both of these considerations push quite strongly towards using a file-per-event approach.

### Files and scale

Basically, I ballpark the number of events per year to consider as about 6000.
That's 500 a month, or on average about 16 a day.

(For some users, it's not anywhere near this number; for others, it might be _more_.
If you use the calendar as a pomodoro log, you'll probably get _much_ more than 16 events a day!)

And let's suppose our most frequent use cases are rendering a window of 1, 4, or about 14 days.
We want those operations to load however much data they need to,
and we don't mind if we have to load a _little_ extra... but more than about double would be weird.
And we probably dont want to load, say, ten times the relevant amount.
Computers are fast, but let's not make the poor machine's life hard;
I want all this to work fast on my poor little phone, too.

The main tool we have in our hands for limiting the amount of excess processing we might stumble into
is to use the filesystem layout as an index.
Filesystems are lovely B+ trees with good caching on intermediate nodes; let's use that.
And the obvious thing to index on is date information, so we can do range queries over dates efficiently.
(We also have a fairly nice, simple challenge as a calendar: date is really the *only* thing that we have a strong requirement of having an efficient index over.)

So with those rough scale goals above in mind,
let's think about how many directories make sense:

- a **directory per year**: definitely.  I think this doesn't even need argument.
- a **directory per month**: yes, I think so.  My hottake is that a directory with more than a thousand files in it is just kinda a bad idea, and so that means a yearly dir isn't enough.  We have to go at least to monthly divisions.
- a **directory per day**: this one's disputable.
  - For the heaviest users, who _also_ inspect things in the file browser frequently, this might be organizationally useful.  But that's going to be a very small set of users.  My guess is that most users probably just won't care.
  - There's no hard scalability reason to make this many subdirectories.  (Popping open a dir with a few hundred files shouldn't lag any reasonable interface or process.)
  - There's no hard scalability reason _not_ to make daily dirs either, though.  (For a user with only one event per day, a whopping 365 inodes get wasted per year on dirs with one file?  _oh no_.  Yeah, I think it'll be fine.)
  - The deciding vote was actually cast by considering the Dataview plugin: Dataview lets you query individual paths, or directories, but it doesn't have a way to do *glob patterns* of files within directories... not without loading and parsing them first, and filtering later.  This becomes a strong vote for using directories per day.  (Using Dataview efficiently on this structure still requires composing multiple queries, but that's a source of friction that's solvable, whereas getting Dataview to load fewer files per directory is (currently) flatly insurmountable.)
  - One argument _against_ daily files is that if a user would create files manually, a dir per month remains typically non-obnoxious, but per day can get rather annoying.  But... since we have UIs and commands for creating events, this doesn't seem like a significant consideration.

All this leads us to: yes, we'll have a directory for each of the year, the month, and the day.

We repeat the full date in each filename, because that seems to be a useful disambiguator in the case of any other integrations or UIs that don't show paths leading up to a file.

(And then yes, the date is repeated *in* the file contents.  Uufdah!  But, this is where we expect it to be edited.
HC will update file paths to match the content in the file.  Seealso discussion of atomicity and when things update, further down.)

#### Files and scale... when we need to see things farther afield

_Most_ of the time, to ask about date $X, you should load all the files in date $X's directory...
and one day forward and one day back, in case there's an event that's in a different date because its native timezone is different than yours.

Of course, that's ignoring events that span multiple days.

There are two kinds of those:

1. Special events, like HorizonCal's concept of "tzchange" events.
2. User events that are simply many, many days long.

The first group is easy.  We give them visibly different filenames.

The second group... **is not currently well-supported.**
Some design work might be required here.

Right now, we don't handle this in any special way...
which means we have to query back for as many days as we fear might contain a super-long event.
Giving multi-day events distinct filenames may be a valid approach,
but doesn't feel entirely satisfying either.
Future work :)


### Files and stability as it applies to diffing

Files should have minimal diffs when changed.
This is important because it affects how well sync tools work
(whether filesystem sync tools or Obsidian's own Sync feature).
For users who may use version control, diff size is noticable to them as well.

Larger diffs, and unpredictable diffs, can result in less efficient version control...
but most problematically, can result in *synchronization conflicts*.

There are two levels where this concern appears:
firstly, in the data file contents themselves;
and secondly, in the filesystem layout and paths to data files.

In the file data contents:
HorizonCal makes a considerable effort to only change fields that it intends to.
HorizonCal applies some minimal normalizations to some data,
but never makes changes to a file purely to normalize it;
some other change that will alter the file must prompt it first.
HorizonCal puts all fields its familiar with at the top of the frontmatter,
in a hardcoded order: this means if a field appears and disappears,
it won't end up in a different part of serialized the frontmatter,
which might have greater likelihood of prompting a synchronization conflict.

On the filesystem:
admittedly, stability took a back seat to the other goals around date-indexed filename patterns.
You'll find that moving events across days, or changing their title, creates a large "git diff" because it _moves the file_.
This trade was made because the scale concern dominates.
In theory, this could mean that moving an event across days, or renaming it,
while a vault is not being actively synchronized to other vaults,
and restarts synchronization later... _could_ result in the event being "duplicated", because a naive sync tool might replicate both the renamed file and the previous file.
In practice, this doesn't seem to happen significantly often;
and of all the problems one can have in synchronization,
this is one that at least doesn't result in data _loss_.


### Atomicity, and When Things Update

Atomicity is tricky.  Ideally, we'd like to patch frontmatter,
change the file path if applicable, and have obsidian do any link rewrites...
all in one atomic transaction.
Unfortunately, that's not how filesystems work :)

The order we perform operations always is:

1. patch frontmatter first;
2. then move files.
3. (and any link rewrites are handled by Obsidian as part of step 2, in an order we don't control.)

This means it's always acceptable to update file paths if there's a desync
between the content and current path: the end state will converge.


----

What are some of the joys of doing this as an Obsidian plugin?
----------------------

There are many :)

From a user perspective:

- We get Obsidian's excellent markdown editor so users can make extended notes with rich formatting.
- Events and their notes can be crosslinked to other notes.  Point at files in your knowledge base you worked on during that event, or have notes that refer to events that generated them, or both.  Use tagging that crosses your knowledge base and events.  Whatever organizational pattern you want to produce, you can do it!
- We get Obsidian's wonderful community of other folks who are united around valuing software that works with plain files and private synchronization!

And from an engineering perspective:

- Obsidian has nice APIs for rapidly reacting to filesystem changes...
  - including supplying a universal cache for parsed frontmatter, which all obsidian plugins can share without any significant coordination problems.  (This is a huge win if one wants to have easy, efficient interop with other systems. E.g. if one wants to process HorizonCal event data with Dataview or other plugins, we calmly magically get to share a cache.  Excellent.)
  - and these change APIs can often be faster to broadcast events than a filesystem poll would be, since Obsidian defacto linearizes changes made by any editors or other plugins.  (For example, using the frontmatter properties editor and pressing "enter" on a field broadcasts a change event _immediately_, rather than with whatever latency a filesystem poller would have.)
  - rename APIs can do automatic link updating!  Internally to HorizonCal alone, this isn't very impactful, but it shows up bigtime if a user crosslinks events and other notes: then, if we rename an event file because its date or title has changed, Obsidian automatically updates all links to that event, anywhere in the vault!  Even in files that HorizonCal wouldn't otherwise understand.  Delightful.
- Obsidian ships to desktop and mobile, and as a plugin, we get all that infrastructure "for free".
- All of the other nice things that Obsidian provides a baseline and community schelling point for: for example, themes.  HorizonCal takes hints from Obsidian's well-documented theme variables for colors, fonts, etc.
