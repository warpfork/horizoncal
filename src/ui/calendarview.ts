import {
	ButtonComponent,
	ItemView,
	Menu,
	WorkspaceLeaf
} from 'obsidian';

import {
	Calendar, DateSelectArg, EventClickArg
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDateTime } from '@fullcalendar/luxon3';

import { HCEvent } from '../data/data';
import HorizonCalPlugin from '../main';
import {
	makeCalendarChangeToVaultUpdateFunc,
	makeEventSourceFunc,
	registerVaultChangesToCalendarUpdates,
} from './CalendarViewWiring';
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

		// The initialization order of this is a little touchy.
		// We create the calendar object with as much configuration as we can.
		// Some callbacks have to be provided immediately and can't be later.
		// Some callbacks have to be created later because they need access to the calendar object,
		//  so those created and added to the calendar later.
		//  (Some of this is reasonable; some of it is also just to ask the calendar's timezone, which is *incredibly* frustrating.)
		// It's a fun API.
		//
		// We don't call the first `render()` until all these callbacks are wired.
		let changeHook = makeCalendarChangeToVaultUpdateFunc(this.plugin);
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
				center: 'dayGridMonth,timeGridWeek,listWeek timeGridFourDay,timeGrid14Day',
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

			// Config to tweak how the interactive parts work:
			editable: true, // Enables the drop and resize callbacks and related UI.
			longPressDelay: 200, // Default is a full second, insanely too long.
			selectable: true, // Enables the select callback and related UI.
			selectMinDistance: 5, // Default is 0px, very silly!

			// Hooks for interactions:
			select: (info: DateSelectArg) => {
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
			eventClick: (info: EventClickArg) => {
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
			eventDrop: changeHook,
			eventResize: changeHook,
		})
		this.calUI.addEventSource({
			events: makeEventSourceFunc(this.plugin, this.calUI),
			color: '#146792',
		});
		this.calUI.render()
	}
}

