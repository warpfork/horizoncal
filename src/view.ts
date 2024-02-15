import {
	ItemView,
	Menu,
	WorkspaceLeaf
} from 'obsidian';


import {
	Calendar,
	EventInput,
	EventSourceInput
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDuration } from '@fullcalendar/luxon3';

import { getAPI } from 'obsidian-dataview';

import { DateTime } from 'luxon';

import { HCEventFrontmatterSchema } from './data';

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
				//console.log("---- queried for", info.start, "through", info.end);
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

				let results: EventInput[] = []
				for (let i in pages.array()) {
					// We're gonna read the frontmatter because it's least wild.
					//console.log("plz", pages[i]) 
					let evtFmRaw = pages[i].file.frontmatter

					// Quick check first.
					if (!evtFmRaw["evtDate"]) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						continue
					}

					// Use Zod to do a lot more validation.
					const evtFmValidation = HCEventFrontmatterSchema.safeParse(evtFmRaw);
					if (!evtFmValidation.success) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						console.log("conversion error:", evtFmValidation.error);
						continue
					}
					let evtFm = evtFmValidation.data;
					// console.log("evtFm ->", evtFm);

					// Turn our three-part time+date+timezone info into a single string we'll pass to FullCalendar.
					// This is going to *lose precision* -- FC can't actually usefully handle the TZ info.
					// (We'll diligently re-attach and persist TZ data every time we get any info back from FC.)
					let startDt = DateTime.fromObject({ ...evtFm.evtDate, ...evtFm.evtTime }, { zone: evtFm.evtTZ });
					let endDt = DateTime.fromObject({ ... (evtFm.endDate || evtFm.evtDate), ...evtFm.endTime }, { zone: evtFm.endTZ || evtFm.evtTZ });
					// TODO we do need to validate the zones were accepted here.  (Everything else should already be covered.)

					results.push({
						title: evtFm.title,
						start: startDt.toISO() as string,
						end: endDt.toISO() as string,
					})
					//console.log("and that made?  this:", results.last())
				}

				successCallback(results)
				//console.log("---- query journey ended")
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
		let calUI = new Calendar(this.calUIEl, {
			plugins: [
				// View plugins
				dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin,
				// System glue plugins
				luxonPlugin,
			],
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

			eventDrop: function (info) {
				// `info.event` -- the new event
				// `info.oldEvent` -- you guessed it
				// `info.delta` -- an object, but an odd one.  It does integer year/month/days, but all finer information in... milliseconds, lmao.  Okay.
				// And again, note that FC already turned ALL timezones into not just fixed offsets, but a single uniform one for the whole calendar and all events.
				// So that was a very lossy change compared to our user's original input data, and should be considered before displaying anything.
				console.log(info.event.title, " was shifted by ", info.delta, " -- new date: ", [info.event.start], "old date:", [info.oldEvent.start]);
			},
			eventResize: function (info) {
				// Similar to the drop events.
				console.log(info.event.title, " was resized by ", toLuxonDuration(info.startDelta, calUI).shiftToAll().normalize().toHuman(), " and ", toLuxonDuration(info.endDelta, calUI).shiftToAll().toHuman());
			},

			// https://fullcalendar.io/docs/eventClick is for opening?
			// i hope it understands doubleclick or... something.
		})
		this.calUI = calUI
		this.calUI.render()
		// console.log("okay here's the calendar's event view!", this.calUI.getEvents())
		// console.log("did our TZs roundtrip?", this.calUI.getEvents().map(evt => evt.start))
		// No, no they did not. `.getTimezoneOffset()` gives a number in minutes, and it's alll the local ones.
		// console.log("howbout wat luxonifier?", this.calUI.getEvents().map(evt => toLuxonDateTime(evt.start as Date, this.calUI)))
		// NOPE, they're all `_zone: SystemZone` now.  Goddamnit.
	}
}
