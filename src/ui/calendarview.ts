import {
	ButtonComponent,
	ItemView,
	Menu,
	TFile,
	WorkspaceLeaf
} from 'obsidian';

import {
	Calendar,
	EventDropArg
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDateTime } from '@fullcalendar/luxon3';

import { HCEvent, HCEventFilePath } from '../data/data';
import HorizonCalPlugin from '../main';
import { makeEventSourceFunc, registerVaultChangesToCalendarUpdates } from './CalendarViewWiring';
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
		// For this next control, we need a whole container div...
		// because it's also going to contain extra menus at these positions.
		// (I wonder if I should yeet all this in the menu/title area, actually.)
		viewNavEl.createDiv("", (el) => {
			let resizeBtn = new ButtonComponent(el)
				.setButtonText("<‡‡‡>")
				.setTooltip("expand/contract view")
			resizeBtn.buttonEl.setCssProps({ "margin": "0em 1em" })
			let menuDiv = resizeBtn.buttonEl.createDiv("yolo")
			el.setCssProps({
				display: "inline-block",
				position: "relative",
			})
			menuDiv.setCssProps({
				position: "absolute",
				top: "90%",
				width: "120px",
				border: "1px solid",
				display: "none",
			})
			resizeBtn.onClick((evt) => {
				menuDiv.setCssProps({ display: "" })
			})

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


		// TODO: hm, wrap a try around this...?
		// Not good if there's an error here, but also its VERY partial.
		// The calendar can and will render and be usable if a single effect source throws an error,
		// but if we don't have the registrations coming below this then it's rather poor.
		// But those hooks also don't make sense to emplace until after initializing this.calUI, so.
		// Or do they.  I guess there's a time quantum here where we've read things, and not put in change hooks, and in practice that's not super relevant given the user, but in theory it is indeed wrong.
		// I'm not used to thinking about weaksauce concurrency; can I just check for null calUI in the handlers and that's actually correct and sufficient?
		this._doCal();

		registerVaultChangesToCalendarUpdates(this.plugin, this, this.calUI);
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

		// The initialization order of this is a little touchy.
		// We create the calendar object with as much configuration as we can,
		// and then have to continue adding several more pieces of wiring and callbacks
		//  *after* the initial calendar object creation, because they need access to it.
		//  (Some of this is reasonable; some of it is just to ask the calendar's timezone, which is *incredibly* frustrating.)
		//
		// We don't call the first `render()` until all these callbacks are wired.
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
		this.calUI.addEventSource({
			events: makeEventSourceFunc(this.plugin, this.calUI),
			color: '#146792',
		});
		this.calUI.render()
	}
}

