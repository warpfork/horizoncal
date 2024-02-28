import {
	ButtonComponent,
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
	EventSourceInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDateTime } from '@fullcalendar/luxon3';

import { HCEvent, HCEventFilePath } from '../data/data';
import { loadRange } from '../data/loading';
import HorizonCalPlugin from '../main';
import { EventEditModal } from './EventEditModal';
import { EventInteractModal } from './EventInteractModal';

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
			events: (info, successCallback, failureCallback) => {
				let hcEvts = loadRange(
					this.plugin,
					toLuxonDateTime(info.start, this.calUI),
					toLuxonDateTime(info.end, this.calUI)
				);
				let fcEvts = hcEvts.map((hcEvt): EventInput => hcEvt.toFCdata(this.plugin.settings))
				successCallback(fcEvts)
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
		this.viewContentEl.addClass("horizoncal");
		let viewNavEl = this.viewContentEl.createEl("div");
		this.calUIEl = this.viewContentEl.createEl("div");

		new ButtonComponent(viewNavEl)
			.setButtonText("<-<-")
			.setTooltip("shift view into past (large step)")
		new ButtonComponent(viewNavEl)
			.setButtonText("<-")
			.setTooltip("shift view into past (small step)")
		let resizeBtn = new ButtonComponent(viewNavEl)
			.setButtonText("<‡‡‡>")
			.setTooltip("expand/contract view")
		resizeBtn.buttonEl.setCssProps({ "margin": "0em 1em" })
		resizeBtn.onClick((evt) => {
			console.log(evt)
			// So I want the effect of a menu (positional, click anywhere else dismisses, etc,
			// but I also want to definltely put html components in it (more buttons -- in a grid layout!),
			// and I'm not sure I can get that out of this Menu type.
			// Because it's worried about being able to have a native mode, it doesn't admit anything about HTML.
			//
			// Hm.  I guess I don't want button clicks to close this one either.
			// So I want.. something considerably different.
			//
			// let m = new Menu()
			// 	.addItem((mitem) => {
			// 		mitem
			// 			.setTitle("hewwo")
			// 			.setIcon("calendar")
			// 			.onClick(async () => {
			// 				alert("yipe!")
			// 			});
			// 	})
			// 	.addSeparator()
			//
			// Menus are rendered as a new top-level element, entirely outside and sibling to the entire 'app-container' div.
			// If you set a 'width' property below, you have to offset 'x' by it, for some reason.
			// m.showAtPosition({ x: evt.pageX, y: evt.pageY })
			// I think I'd rather position this in a fixed relationship to the button, but can't find the right offsets.
			// It must be possible though: this is what obsidian's on behavior is on most of the default menus.
			//.showAtPosition({ x: resizeBtn.buttonEl.offsetLeft, y: resizeBtn.buttonEl.offsetTop })

			let menuDiv = resizeBtn.buttonEl.createDiv("yolo")
			menuDiv.createDiv("", (el) => {
			new ButtonComponent(el)
				.setButtonText("<+")
				.setTooltip("expand view into past")
			new ButtonComponent(el)
				.setButtonText("+>")
				.setTooltip("expand view into future")
			})
			menuDiv.createDiv("", (el) => {
				new ButtonComponent(el)
					.setButtonText("-<")
					.setTooltip("contract view from past")
				new ButtonComponent(el)
					.setButtonText(">-")
					.setTooltip("contract view from future")
			})

		})
		new ButtonComponent(viewNavEl)
			.setButtonText("->")
			.setTooltip("shift view into future (small step)")
		new ButtonComponent(viewNavEl)
			.setButtonText("->->")
			.setTooltip("shift view into future (large step)")


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
				console.log("metadata change!", file, cache);

				// If frontmatter isn't present, it more or less means "new file".
				// We also get another event when the frontmatter has been loaded into the cache,
				// so... we can just return early and ignore events without that data present.
				if (!cache.frontmatter) {
					return
				}

				// For events already in the calendar: we update them.
				// If not: we add it one.
				// (TODO: should filter for the relevance of date.)
				let hcEvt = HCEvent.fromFrontmatter(cache.frontmatter);
				hcEvt.loadedFrom = file.path;
				let fcEvt = this.calUI.getEventById(file.path);
				if (fcEvt == null) {
					// New event!
					this.calUI.addEvent(hcEvt.toFCdata(this.plugin.settings))
					// FIXME it gets a different default background because not event source; silly.
					//  It seems we can give an EventSourceImpl handle as another param; worth?  Hm.  Probably.
				} else {
					// Updating takes a little different road.
					// Most things can be resynced through 'setProp';
					// the start and end dates require specific methods, due to reasons.
					//
					// Could we just nuke and replace the event?
					// Maybe, but in some cases that might fuck with the UI;
					// for example, on mobile, you have to hold-select something to make it adjustable.
					let newData: EventInput = hcEvt.toFCdata(this.plugin.settings);
					for (let prop in newData) {
						if (prop == "id") continue; // Already sure of that thanks.
						if (prop == "start") { fcEvt.setStart(newData[prop]!); continue }
						if (prop == "end") { fcEvt.setEnd(newData[prop]!); continue }
						fcEvt.setProp(prop, newData[prop])
					}
				}

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
		menu.addSeparator();
		// Startlingly, having a way to close a view is *not the default* on mobile.
		// So we'll make sure there's at least an option in the menu (like there is for editor views).
		menu.addItem((item) => {
			item
				.setTitle("Close")
				.setIcon("x")
				.onClick(async () => {
					this.leaf.detach();
				});
		});
	}

	async onResize() {
		this.calUI.updateSize() // `render()` would be the more aggressive choice, but shouldn't be necessary.
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
				let newStartDt = toLuxonDateTime(info.event.start as Date, this.calUI).setZone(hcEvt.evtTZ.valueStructured)
				let newEndDt = toLuxonDateTime(info.event.end as Date, this.calUI).setZone(hcEvt.endTZ.valueStructured || hcEvt.evtTZ.valueStructured)

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
					await this.plugin.app.vault.createFolder(`${this.plugin.settings.prefixPath}/${path.dirs}`)
				} catch { }
				// FIXME: filename collision handling needs a better definition.
				//  Right now, we _already updated_ the frontmatter in the file (and that's a different filesystem atomicity phase),
				//  so we can end up with the filename not being in sync.
				//  This is surprisingly non-catestrophic (as in, doesn't instantly destroy user data or break the UI),
				//    as long as we still keep editing the original path...
				//  But it's still not _good_, because it means when reopening the calendar,
				//    the event might not get loaded if its old path was for a day that's not in view.
				try {
					await this.plugin.app.fileManager.renameFile(file, `${this.plugin.settings.prefixPath}/${wholePath}`)
				} catch (error) {
					alert("Error: could not move event file -- " + error
						+ "\n\nThis may not cause immediate problems but may cause the event to not be loaded by functions using time windows.");
					return
				}
				info.event.setProp("id", `${this.plugin.settings.prefixPath}/${wholePath}`) // FIXME canonicalization check, double slash would be bad here.
			}

			// Note that either (or indeed, both) of the above two filesystem updates
			// may cause change detection hooks to... propagate the updated values back to FullCalendar again!
			// _This turns out to be fine_, because it's effectively idempotent.
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
				left: '',
			},
			views: {
				timeGridFourDay: {
					type: 'timeGrid',
					duration: { days: 4 },
					dateIncrement: { days: 1 },
					slotEventOverlap: false,
				},
				timeGrid14Day: {
					type: 'timeGrid',
					duration: { days: 14 },
					dateIncrement: { days: 1 },
					slotEventOverlap: false,
				},
			},
			nowIndicator: true,
			// scrollTime: // probably ought to be set so "now" is in it, yo...
			// the 'scrollToTime' method might also be the right thing.
			scrollTimeReset: false,
			height: "100%",
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

			eventClick: (info) => {
				// This hook works by... fully reloading the file assumed to back the event.
				// This works fine for HC-native events, but will be much less fine if we add other event sources.
				let evtOrError = HCEvent.fromPath(this.app, info.event.id);
				if (evtOrError instanceof Error) {
					alert("cannot use HC's event editors; event id did not map to a file path!");
					return
				}
				let hcEvt = evtOrError;
				new EventInteractModal(this.plugin, hcEvt).open();
			},

			// Dragging?  Spicy.
			editable: true, // Enables the drop and resize callbacks and related UI.
			longPressDelay: 200, // Default is a full second, insanely too long.
			eventDrop: changeHook,
			eventResize: changeHook,
			selectable: true, // Enables the select callback and related UI.
			selectMinDistance: 5, // Default is 0px, very silly!
			select: (info) => {
				let startDt = toLuxonDateTime(info.start, this.calUI)
				let endDt = toLuxonDateTime(info.end, this.calUI)

				// Invent some initial "frontmatter" and pop open a modal.
				// The modal will handle further editing, and can persist a new file.
				new EventEditModal(this.plugin, HCEvent.fromFrontmatter({
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
		this.eventSources.map((evtSrc) => this.calUI.addEventSource(evtSrc))
		this.calUI.render()
	}
}

