import {
	CachedMetadata,
	ItemView,
	Menu,
	TAbstractFile,
	TFile,
	WorkspaceLeaf
} from 'obsidian';

import {
	Calendar,
	EventDropArg,
	EventInput,
	EventSourceInput
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDateTime } from '@fullcalendar/luxon3';

import { getAPI, Literal } from 'obsidian-dataview';

import { HCEvent, HCEventFilePath } from '../data/data';
import HorizonCalPlugin from '../main';
import { NewEventModal } from './eventmodal';

export const VIEW_TYPE = "horizoncal-view";

var uniq = 1;

export class HorizonCalView extends ItemView {
	constructor(plugin: HorizonCalPlugin, leaf: WorkspaceLeaf) {
		super(leaf);
		this.plugin = plugin;
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

	plugin: HorizonCalPlugin;
	uniq: number; // Not structural.  Using this for sanitycheck during dev.
	viewContentEl: Element; // Reference grabbed during onOpen.
	calUIEl: HTMLElement; // Div created during onOpen to be fullcal's root.
	calUI: Calendar; // Fullcal's primary control object.

	eventSources: EventSourceInput[] = [
		{
			events: function (info, successCallback, failureCallback) {
				//console.log("---- queried for", info.start, "through", info.end);
				// .query({
				// 	start: info.start.valueOf(),
				// 	end: info.end.valueOf()
				// })

				type DVT_Record = Record<string, Literal> & { file: TFile };
				const dv = getAPI();
				const pages = dv.pages('"sys/horizoncal"')
					.where((p: DVT_Record) => String(p.file.name).startsWith("evt-"))

				let results: EventInput[] = []
				for (let i in pages.array()) {
					// We're gonna read the frontmatter because it's least wild.
					let evtFmRaw = pages[i].file.frontmatter

					// Quick check first.
					if (!evtFmRaw["evtDate"]) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						continue
					}

					// Use HCEvent to do a parse.
					// An HCEvent is something you can produce unconditionally:
					// it just might contain data that's flagged as not valid.
					let hcEvt = HCEvent.fromFrontmatter(evtFmRaw);
					let hcEvtErr = hcEvt.validate();
					if (hcEvtErr) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						console.log("conversion error:", hcEvtErr);
						continue
					}

					// console.log(hcEvt, hcEvt.getCompleteStartDt().toISO());
					results.push({
						id: pages[i].file.path,
						title: hcEvt.title.valueRaw,
						// Turn our three-part time+date+timezone info into a single string we'll pass to FullCalendar.
						// This is going to *lose precision* -- FC can't actually usefully handle the TZ info.
						// (We'll diligently re-attach and persist TZ data every time we get any info back from FC.)
						start: hcEvt.getCompleteStartDt().toISO() as string,
						end: hcEvt.getCompleteEndDt().toISO() as string,
					})
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

		// So about events.
		// There are many different places you can hook.  Some more useful (and efficient) than others.
		// For all of these, _we only do it for the lifetime of the view_.
		// If you don't have the calendar view open, there's no need for us to be updating anything.
		// (TODO: there may be one exception to this; we might want the "keep filename in sync" rule to be in effect at all times.
		//
		// We use:
		//  - `metadataCache.on("changed", ...)` -- it covers most of the bases, and gloriously, provides the already parsed frontmatter.
		//  - `vault.on("rename", ...)` -- specifically because the metadata cache change event doesn't cover renames.
		//  - `metadataCache.on("deleted", ...)` -- also not covered by the metadata cache change event.
		//
		// We _don't_ use:
		//  - `vault.on("create", ...)` -- it's covered by `metadataCache.on("changed", ...)`
		//  - `vault.on("modify", ...)` -- it's covered by `metadataCache.on("changed", ...)`
		//  - `vault.on("delete", ...)` -- it's covered by `metadataCache.on("deleted", ...)`, which is similar but mildly more informative (maybe).
		//  - `metadataCache.on("dataview:metadata-change", ...)` -- it sure works, but we're trying to avoid direct dependency on Dataview.
		//
		// Note for changes and renames alike, the handlers can be considerably redundant if the change came *from* the UI.
		// But that's rather hard for us to tell, and idempotency means it makes little difference, so!
		this.registerEvent(this.app.vault.on("rename",
			(file: TAbstractFile, oldPath: string) => {
				console.log("rename event!")
				let fcEvt = this.calUI.getEventById(oldPath);
				if (fcEvt != null) {
					fcEvt.setProp("id", file.path)
				}
			}));
		this.registerEvent(this.app.metadataCache.on("changed",
			(file: TFile, data: string, cache: CachedMetadata) => {
				console.log("metadata change!", cache, data);
				// We can use whether an event matching that filename was alreayd in the calendar
				//  as crude proxy for both {whether it's an event} and {whether it's in range of the view, thus we care}.
				// TODO this is incomplete, though -- if something moves into the view range, then, well.
				// TOOD also new file creation that's in range is a helluva example of that lol
				let fcEvt = this.calUI.getEventById(file.path);
				if (fcEvt == null) {
					return
				}
				let hcEvt = HCEvent.fromFrontmatter(cache.frontmatter);
				fcEvt.setProp("title", hcEvt.title.valueRaw)
				fcEvt.setStart(hcEvt.getCompleteStartDt().toISO() as string)
				fcEvt.setEnd(hcEvt.getCompleteEndDt().toISO() as string)

				// TODO you may also want to hook a rename consideration on this.
				// If the action is a user edit to the frontmatter... yeah, it's possible the file path should get resynced to it.
			}));
		this.registerEvent(this.app.metadataCache.on("deleted",
			(file: TFile, prevCache: CachedMetadata | null) => {
				console.log("delete event!")
				// How very fortunate that file paths alone are event IDs.
				// The 'prevCache' value is best-effort, so if we needed it, we'd be in trouble.
				let fcEvt = this.calUI.getEventById(file.path);
				if (fcEvt != null) {
					fcEvt.remove()
				}
			}));
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
		// Problematic: this thing is reattaching its stylesheet repeatedly, and it's not deleting that again.
		console.log("hc view closed", this);
		if (this.calUI) this.calUI.destroy()
	}

	_doCal() {
		if (this.calUI) this.calUI.destroy();

		// This change hook function is used for both fullcal's `eventDrop` and `eventResize` callbacks.
		// They're very similar, except the resize callback gets two different delta values in its info param.
		// They both have old and new events, though, and those both have start and end times,
		// and since we based all our logic on that rather than deltas, we get to reuse the function completely for both.
		let changeHook = async (info: EventDropArg | EventResizeDoneArg) => {
			// Step one: figure out what file we want to update for this.
			// Or, balk immediately if we can't figure it out somehow.
			if (!info.event.id) {
				alert("cannot alter that event; no known data source");
				info.revert()
				return
			}
			let file = this.plugin.app.vault.getAbstractFileByPath(info.event.id)
			if (!file || !(file instanceof TFile)) {
				alert("event id did not map to a file path!");
				info.revert()
				return
			}

			// Step two: we'll use the fileManager to do an update of the frontmatter.
			// (This handles a lot of serialization shenanigans for us very conveniently.)
			let hcEvt: HCEvent;
			await this.plugin.app.fileManager.processFrontMatter(file, (fileFm: any): void => {
				// Parse the existing frontmatter, as a precursor to being ready to save it with modifications.
				// And also because we need the timezone info.
				// (Some of this work may be mildly excessive, but it achieves a lot of annealing of data towards convention.)
				hcEvt = HCEvent.fromFrontmatter(fileFm)

				// TODO some validity checks are appropriate here.
				// f.eks. if timezone strings aren't valid, this is gonna go south from here.

				// Shift the dates we got from fullcalendar back into the timezones this event specified.
				//  Fullcalendar doesn't retain timezones -- it flattens everything to an offset only (because javascript Date forces that),
				//   and it also shifts everything to the calendar-wide tz offset.  This is quite far from what we want.
				let newStartDt = toLuxonDateTime(info.event.start as Date, this.calUI).setZone(hcEvt.evtTZ.valueParsed)
				let newEndDt = toLuxonDateTime(info.event.end as Date, this.calUI).setZone(hcEvt.endTZ.valueParsed || hcEvt.evtTZ.valueParsed)

				// Stir our updated dates into the data.
				// This roundtrips things through strings, which... may seem unnecessary?
				// But on the other hand, that's what we really store, and being literal is good.
				// (Also, I was too lazy to introudce a "setParsed" system to Control; it would require an alternative simplify func, and how we're building the whole magma burrito family; no.)
				hcEvt.evtDate.update(newStartDt.toFormat("yyyy-MM-dd"))
				hcEvt.evtTime.update(newStartDt.toFormat("HH:mm"))
				hcEvt.endDate.update(newEndDt.toFormat("yyyy-MM-dd"))
				hcEvt.endTime.update(newEndDt.toFormat("HH:mm"))

				// Now foist the event structure back into frontmatter form... mutating the object we started with.
				hcEvt.foistFrontmatter(fileFm);

				// Persistence?
				// It's handled magically by processFrontMatter as soon as this callback returns:
				//  it persists our mutations to the `fileFm` argument.
			});

			// Step three: decide if the filename is still applicable or needs to change -- and possibly change it!
			// If we change the filename, we'll also change the event ID.
			let path = HCEventFilePath.fromEvent(hcEvt!);
			let wholePath = path.wholePath;
			if (wholePath != info.event.id) {
				console.log("moving to", wholePath)
				try {
					// Wrapped in a `try` because it throws on "already exists".
					// TODO bother to react better to other errors.
					await this.plugin.app.vault.createFolder("sys/horizoncal/" + path.dirs)
				} catch { }
				await this.plugin.app.fileManager.renameFile(file, "sys/horizoncal/" + wholePath)
				info.event.setProp("id", "sys/horizoncal/" + wholePath)
			}
		}

		this.calUI = new Calendar(this.calUIEl, {
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
			editable: true, // Enables the drop and resize callbacks and related UI.
			longPressDelay: 200, // Default is a full second, insanely too long.
			eventDrop: changeHook,
			eventResize: changeHook,
			// dateClick: (info) => {
			// 	// I don't think we have a way to detect "double click".  It's an event registration thing, not a field on the event.
			// 	// On mobile: this does fire.  And it doesn't fire on drag.  So that's good.
			// 	// 'select' might be more what I want, though.
			// 	let dt = toLuxonDateTime(info.date, this.calUI)
			// 	alert("TODO: make new event for " + dt.toFormat("yyyy-MM-dd HH:mm"))
			// },
			selectable: true, // Enables the select callback and related UI.
			// There are some fun params to this like `selectMinDistance` and `selectMirror`, but so far I don't see the appeal of engaging them.
			select: (info) => {
				let startDt = toLuxonDateTime(info.start, this.calUI)
				let endDt = toLuxonDateTime(info.end, this.calUI)

				// Invent some initial "frontmatter" and pop open a modal.
				// The modal will handle further editing, and can persist a new file.
				new NewEventModal(this.plugin, HCEvent.fromFrontmatter({
					title: "untitled",
					evtType: "default",
					evtDate: startDt.toFormat("yyyy-MM-dd"),
					evtTime: startDt.toFormat("HH:mm"),
					evtTZ: startDt.zoneName,
					endDate: endDt.toFormat("yyyy-MM-dd"),
					endTime: endDt.toFormat("HH:mm"),
					endTZ: endDt.zoneName,
				})).open();
			},
		})
		this.calUI.render()
	}
}

