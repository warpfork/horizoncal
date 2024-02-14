import {
	ItemView,
	Menu,
	WorkspaceLeaf
} from 'obsidian';


import {
	Calendar,
	EventSourceInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import { getAPI } from 'obsidian-dataview';


export const VIEW_TYPE = "horizoncal-view";

var uniq = 1;

export class HorizonCalView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.uniq = uniq++;
	}

	getViewType() {
		return VIEW_TYPE;
	}
	getIcon(): string {
		return "calendar-glyph";
	}
	getDisplayText() {
		return "Horizon Calendar " + this.uniq;
	}
	public navigation: false; // Don't generally let me click away from this view.

	uniq: number; // Not structural.  Using this for sanitycheck during dev.
	viewContentEl: Element; // Reference grabbed during onOpen.
	calUIEl: HTMLElement; // Div created during onOpen to be fullcal's root.
	calUI: Calendar; // Fullcal's primary control object.

	eventSources: EventSourceInput[] = [
		{
			events: [
				{
					title: 'Event1',
					start: '2024-02-12'
				},
				{
					title: 'Event2',
					start: '2024-02-12T12:30:00',
					end: '2024-02-12T13:30:00'
					// 'background' property is neat.
				}
			],
			color: 'yellow',   // an option!
			textColor: 'black', // an option!

			startEditable: true,
			durationEditable: true,
		},
		{
			events: function (info, successCallback, failureCallback) {
				console.log("queried for", info.start, "through", info.end);
				// .query({
				// 	start: info.start.valueOf(),
				// 	end: info.end.valueOf()
				// })

				// So about Dataview.
				//
				// Dataview does a lot.  Some of it helpful, some of it... imo, kind of a waste of time.
				// The helpful parts are so numerous they don't bear listing.
				// The less helpful parts:
				//   - Every field in the frontmatter that's got capital letters?  It gets cloned to a downcased one.
				//      -> this makes it confusing to range over the set because it's got duplicates!
				//      -> it's also a waste of memory!  Big sigh.
				//   - Anything that looks like a date got parsed to a Luxon DateTime object already!
				//      -> cool for the purpose of dv queries themselves...
				//      -> it's a little wasteful for our purposes, because we're just gonna turn around and integrate with another API that doesn't use that format.
				//      -> and when I said "date"?  I mean with YYYY-MM-DD.  It doesn't detect or do anything with HH:MM.
				//   - DV has gathered outlinks, inlinks, tasks, lists...
				//      -> the latter two don't really matter much in practice (event file contents are pretty short), but it's unnecessary work.
				//      -> inlinks required DV to index and parse *how much??* of my vault?  Very unnecessary work.
				//
				// The way to safely ignore all this is to peep `.file.frontmatter`.  That has the originals.
				// And I think someday we might have a compelling argument for making our own simpler query system that does _less_.
				// (Or find some flags to DV that ask it to Do Less; that'd be great.)
				//
				const dv = getAPI();
				const pages = dv.pages('"sys/horizoncal"')
					.where(p => String(p.file.name).startsWith("evt-"))
				//.where(p => p.file.day - weekStart >= 0 && p.file.day - weekStart < dvdur("7d")) // how does dv infer this?
				//.sort((p) => p.file.name, 'asc')
				console.log("dv shows this:", pages[0])

				// TODO emit a warning for things with no TZ?  or instantly fixate it?
				// Korganizer just shamelessly did everything in Zulu and ... I don't love it for that but also never honestly noticed.
				// Thing is, I *like* my convention of "i'm just rendering everything as local to the timezone i'll be in at the time".
				// Scrolling across years of data and the "working hours" stay in the middle of the screen is fucking great.
				// The trouble is that it objectively loses information.
				// Can I have fullcalendar render different days with different prevailing TZs?
				// Can I have it switch TZ midday?  Probably not lol, because what even.
				// The only reason that defacto was a nonissue for me was that flights were always still slightly longer than the timeshift.
				// The most egregious possible way to hack this together is render two calendars and one day gets shown twice with partial content (and then render a dummy background event to say "whoopsie"; and good luck with things that cross the line.).
				// Another option is just to add extra buttons and prompts that let you switch view mode fast when you scroll onto days that have other TZs.
				// This could be combined with background events that make rendered warnings about TZ shifts.  Maybe.  (Tricky to infer where that should be drawn exactly.)
				// (I'm thinking also about the business hours built in feature being a bit comical here.)
				// Not sure that having events with other TZs is actually the cue to use.  That happens for meetings on shared calendars all the time.
				// A custom event that's a marker for "shift my view please" is probably actually totally reasonable though!
				// Maybe these should have Special filename patterns so we can pluck them out at great range.  It's something I'd wanna base a lot on, for months at a time.

				successCallback(pages.array())
				return null
			},
			color: '#146792',
		},
	]

	async onOpen() {
		// The first element in containerEl is obsidian's own header.
		// The second is the content div you're expected to use for most content.
		this.viewContentEl = this.containerEl.children[1];
		this.viewContentEl.empty();
		this.viewContentEl.createEl("h4", { text: "Horizon Calendar" });
		this.calUIEl = this.viewContentEl.createEl("div", { cls: "horizoncal" });
		this._doCal();
	}

	async onPaneMenu(menu: Menu) {
		menu.addItem((item) => {
			item
				.setTitle("BONK FULLCAL 👈")
				.setIcon("document")
				.onClick(async () => {
					this._doCal();
				});
		});
	}

	async onResize() {
		this.calUI.render() // `updateSize()` might be enough, but, abundance of caution.
	}

	async onClose() {
		if (this.calUI) this.calUI.destroy()
	}

	_doCal() {
		if (this.calUI) this.calUI.destroy();
		this.calUI = new Calendar(this.calUIEl, {
			plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
			initialView: 'timeGridFourDay',
			headerToolbar: {
				right: 'prev,next today',
				// future work: additional nav buttons of our own that manage via 'gotoDate' and 'visibleRange'.
				center: 'dayGridMonth,timeGridWeek,timeGridFourDay,timeGrid14Day,listWeek',
				left: 'title',
			},
			views: {
				timeGridFourDay: {
					type: 'timeGrid',
					duration: { days: 4 },
					dateIncrement: { days: 1 },
				},
				timeGrid14Day: {
					type: 'timeGrid',
					duration: { days: 14 },
					dateIncrement: { days: 1 },
				},
			},
			nowIndicator: true,
			// scrollTime: // probably ought to be set so "now" is in it, yo...
			// the 'scrollToTime' method might also be the right thing.
			scrollTimeReset: false,
			height: "auto",
			eventSources: this.eventSources,
			businessHours: {
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: '09:00',
				endTime: '23:00',
			},
			slotLabelInterval: '1:00',
			slotDuration: '00:30:00',
			snapDuration: '00:15:00',
			// slotLabelFormat: // actually, leaving this unset, because am/pm here is okay... since we use 24hr in the event labels.
			eventTimeFormat: { // like '14:30:00'
				hour: '2-digit',
				minute: '2-digit',
				omitZeroMinute: true,
				hour12: false
			},

			// Dragging?  Spicy.
			editable: true,
			// todo: https://fullcalendar.io/docs/eventDrop is 99% of it.
			// and then https://fullcalendar.io/docs/eventResize is the second 99%.
			// okay, creating new events by clicking empty space might also need another hook.

			// https://fullcalendar.io/docs/eventClick is for opening?
			// i hope it understands doubleclick or... something.
		})
		this.calUI.render()
	}
}
