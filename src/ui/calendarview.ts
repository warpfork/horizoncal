import { ButtonComponent, ItemView, Menu, WorkspaceLeaf } from "obsidian";

import * as fc from "@fullcalendar/core";
import * as fci from "@fullcalendar/interaction";
import dayGridPlugin from "@fullcalendar/daygrid";
import multiMonthPlugin from "@fullcalendar/multimonth";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";

import luxonPlugin, { toLuxonDateTime } from "@fullcalendar/luxon3";

import { HCEvent } from "../data/data";
import HorizonCalPlugin from "../main";
import {
	makeCalendarChangeToVaultUpdateFunc,
	makeEventSourceFunc,
	registerVaultChangesToCalendarUpdates,
} from "./CalendarViewWiring";
import { EventEditModal } from "./EventEditModal";
import { EventInteractModal } from "./EventInteractModal";

export const VIEW_TYPE = "horizoncal-view";

let uniq = 1;

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
	calUI: fc.Calendar; // Fullcal's primary control object.

	async onOpen() {
		// The first element in containerEl is obsidian's own header.
		// The second is the content div you're expected to use for most content.
		this.viewContentEl = this.containerEl.children[1];
		this.viewContentEl.empty();
		this.viewContentEl.addClass("horizoncal");
		const viewNavEl = this.viewContentEl.createEl("div");
		this.calUIEl = this.viewContentEl.createEl("div");

		new ButtonComponent(viewNavEl)
			.setButtonText("<-<-")
			.setTooltip("shift view into past (large step)");
		new ButtonComponent(viewNavEl)
			.setButtonText("<-")
			.setTooltip("shift view into past (small step)");
		// For this next control, we need a whole container div...
		// because it's also going to contain extra menus at these positions.
		// (I wonder if I should yeet all this in the menu/title area, actually.)
		viewNavEl.createDiv("", (el) => {
			const resizeBtn = new ButtonComponent(el)
				.setButtonText("<‡‡‡>")
				.setTooltip("expand/contract view");
			resizeBtn.buttonEl.setCssProps({ margin: "0em 1em" });
			const menuDiv = resizeBtn.buttonEl.createDiv("yolo");
			el.setCssProps({
				display: "inline-block",
				position: "relative",
				"z-index": "1",
			});
			menuDiv.setCssProps({
				position: "absolute",
				top: "90%",
				width: "120px",
				border: "1px solid",
				display: "none",
			});
			resizeBtn.onClick((evt) => {
				menuDiv.setCssProps({ display: "" });
			});

			menuDiv.createDiv("", (el) => {
				new ButtonComponent(el)
					.setButtonText("<+")
					.setTooltip("expand view into past")
					.onClick(() => {
						const newRange: fc.DateRangeInput = {
							start: toLuxonDateTime(
								this.calUI.view.currentStart,
								this.calUI,
							)
								.minus({ day: 1 })
								.toISODate()!,
							end: this.calUI.view.currentEnd,
						};
						// console.log("bonked the button", this.calUI.view, newRange)
						this.calUI.changeView("timeGrid", newRange);
					});
				new ButtonComponent(el)
					.setButtonText("+>")
					.setTooltip("expand view into future")
					.onClick(() => {
						const newRange: fc.DateRangeInput = {
							start: this.calUI.view.currentStart,
							end: toLuxonDateTime(
								this.calUI.view.currentEnd,
								this.calUI,
							)
								.plus({ day: 1 })
								.toISODate()!,
						};
						// console.log("bonked the button", this.calUI.view, newRange)
						this.calUI.changeView("timeGrid", newRange);
					});
			});
			menuDiv.createDiv("", (el) => {
				new ButtonComponent(el)
					.setButtonText("-<")
					.setTooltip("contract view from past");
				new ButtonComponent(el)
					.setButtonText(">-")
					.setTooltip("contract view from future");
			});
		});
		new ButtonComponent(viewNavEl)
			.setButtonText("->")
			.setTooltip("shift view into future (small step)");
		new ButtonComponent(viewNavEl)
			.setButtonText("->->")
			.setTooltip("shift view into future (large step)");

		// TODO: hm, wrap a try around this...?
		// Not good if there's an error here, but also its VERY partial.
		// The calendar can and will render and be usable if a single effect source throws an error,
		// but if we don't have the registrations coming below this then it's rather poor.
		// But those hooks also don't make sense to emplace until after initializing this.calUI, so.
		// Or do they.  I guess there's a time quantum here where we've read things, and not put in change hooks, and in practice that's not super relevant given the user, but in theory it is indeed wrong.
		// I'm not used to thinking about weaksauce concurrency; can I just check for null calUI in the handlers and that's actually correct and sufficient?
		this._createCal();

		this.calUI.render();
	}

	async onPaneMenu(menu: Menu) {
		menu.addItem((item) => {
			item.setTitle("BONK FULLCAL 👈")
				.setIcon("document")
				.onClick(async () => {
					await this.plugin.loadSettings();
					this._createCal();
					this.calUI.render();
				});
		});
		menu.addSeparator();
		// Startlingly, having a way to close a view is *not the default* on mobile.
		// So we'll make sure there's at least an option in the menu (like there is for editor views).
		menu.addItem((item) => {
			item.setTitle("Close")
				.setIcon("x")
				.onClick(async () => {
					this.leaf.detach();
				});
		});
	}

	async onResize() {
		this.calUI.updateSize(); // `render()` would be the more aggressive choice, but shouldn't be necessary.
	}

	async onClose() {
		// Problematic: this thing is reattaching its stylesheet repeatedly, and it's not deleting that again.
		console.log("hc view closed", this);
		if (this.calUI) this.calUI.destroy();
	}

	_createCal() {
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
		const changeHook = makeCalendarChangeToVaultUpdateFunc(this.plugin);
		this.calUI = new fc.Calendar(this.calUIEl, {
			plugins: [
				// View plugins
				dayGridPlugin,
				timeGridPlugin,
				listPlugin,
				multiMonthPlugin,
				fci.default,
				// System glue plugins
				luxonPlugin,
			],
			initialView: "timeGridFourDay",
			headerToolbar: {
				right: "prev,next today",
				// future work: additional nav buttons of our own that manage via 'gotoDate' and 'visibleRange'.
				center: "dayGridYear,dayGridMonth,monthAll,multiMonthYear,timeGridWeek timeGridFourDay,timeGrid14Day",
				// There are many other default views.  For example, "listWeek".  I don't find it inspiring, though.
				left: "",
			},
			// lazyFetching: false, // empirically unnecessary, given our viewDidMount hook.
			// And we need the viewDidMount hook to force `refetchEvents`, because otherwise switching to smaller view ranges tends not to cause a new fetch.
			// ... this is driving me to derangement.
			// This is only called when it switches view *types*.  Not when it switches views.
			// So if I try to have two different things of type dayGridMonth, then whichever of them is switched to... has effects that last if you then switch to the other.
			// dayGridYear and dayGridMonth are also the same view type, for this purpose.
			// I don't know what to say at this point except this is an incredibly deranged series of APIs and if I had an alternative to this library, I would take it.
			//
			// My best remaining guess for how to get a grip of all this is that we have to stop using the built-in toolbar entirely and replace those buttons so we can hook their behavior to do sane things.
			viewDidMount: (arg: fc.ViewMountArg) => {
				console.log("viewDidMount called.", arg);
				// This also wastes so much work that it thonks for a perceptable moment (~100ms?) on my desktop.  Sheesh.
				arg.view.calendar.removeAllEvents();
				arg.view.calendar.refetchEvents();

				// evt.display = "none"; // TODO: this might be a better option.
				// Set it back to "auto" when done.
			},
			views: {
				dayGridMonth: {
					// how filter plz.
					// it's definitely NOT at the eventSource level, because FC is smart enough to not be asking that again on view switch.
					// ... well, kind of.  if you switch to a smaller view, it's calm.
					// if you actually move around with that view, once it goes forward very far, it apparently drops memory.
					// which makes the whole thing seem rather pointless.
				},
				monthAll: {
					type: "dayGridMonth",
					buttonText: "month (all)",
				},
				timeGridFourDay: {
					type: "timeGrid",
					duration: { days: 4 },
					dateIncrement: { days: 1 },
					slotEventOverlap: false,
					// dateClick: (arg: fci.DateClickArg) => {}, // Not what you want.  Captures any click on the whole time range of the day, and NOT on the date header of the column.
					// eventConstraint,
					// eventDisplay: "what",
					// footerToolbar: { center: "hello" },
					// headerToolbar: false,
					// moreLinkClick // idk but no.
				},
				timeGrid14Day: {
					type: "timeGrid",
					duration: { days: 14 },
					dateIncrement: { days: 1 },
					slotEventOverlap: false,
				},
			},
			nowIndicator: true,
			weekNumbers: true,
			// scrollTime: // probably ought to be set so "now" is in it, yo...
			// the 'scrollToTime' method might also be the right thing.
			scrollTimeReset: false,
			height: "100%",
			businessHours: {
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: "09:00",
				endTime: "23:00",
			},
			slotLabelInterval: "1:00",
			slotDuration: "00:30:00",
			snapDuration: "00:15:00",
			// slotLabelFormat: // actually, leaving this unset, because am/pm here is okay... since we use 24hr in the event labels.
			eventTimeFormat: {
				// like '14:30:00'
				hour: "2-digit",
				minute: "2-digit",
				omitZeroMinute: true,
				hour12: false,
			},

			// Config to tweak how the interactive parts work:
			editable: true, // Enables the drop and resize callbacks and related UI.
			longPressDelay: 200, // Default is a full second, insanely too long.
			selectable: true, // Enables the select callback and related UI.
			selectMinDistance: 5, // Default is 0px, very silly!

			// Make drag of events to allDay be remotely sane.
			allDayMaintainDuration: true, // Otherwise the default is to simply discard their end date!

			// Hooks for interactions:
			select: (info: fc.DateSelectArg) => {
				const startDt = toLuxonDateTime(info.start, this.calUI);
				const endDt = toLuxonDateTime(info.end, this.calUI);

				// Invent some initial "frontmatter" and pop open a modal.
				// The modal will handle further editing, and can persist a new file.
				new EventEditModal(
					this.plugin,
					HCEvent.fromFrontmatter({
						title: "untitled",
						evtDate: startDt.toFormat("yyyy-MM-dd"),
						evtTime: startDt.toFormat("HH:mm"),
						evtTZ: startDt.zoneName,
						endDate: endDt.toFormat("yyyy-MM-dd"),
						endTime: endDt.toFormat("HH:mm"),
						endTZ: endDt.zoneName,
					}),
				).open();
			},
			eventClick: (info: fc.EventClickArg) => {
				console.log(`clicked '${info.event.id}'`, info);
				// This hook works by... fully reloading the file assumed to back the event.
				// This works fine for HC-native events, but will be much less fine if we add other event sources.
				const evtOrError = HCEvent.fromPath(this.app, info.event.id);
				if (evtOrError instanceof Error) {
					alert(
						"cannot use HC's event editors; event id did not map to a file path!",
					);
					return;
				}
				const hcEvt = evtOrError;
				new EventInteractModal(this.plugin, hcEvt).open();
			},
			eventDrop: changeHook,
			eventResize: changeHook,

			// And enable a few more links to do stuff:
			navLinks: true,
			navLinkDayClick: (date: Date, jsEvent: UIEvent) => {
				// THIS IS WHAT I WANTED.
				if (this.calUI.view.type == "dayGridMonth") {
					this.calUI.changeView("timeGridFourDay", {
						// this argument seems to do nothing in practice, so we gotoDate right after this.
						start: date,
						end: date,
					});
					this.calUI.gotoDate(date);
				} else {
					// TODO: navigate to daily note file.
				}
			},
			navLinkWeekClick: (date: Date, jsEvent: UIEvent) => {
				alert("week zow"); // works on dayGridMonth; doesn't work on the timegrid views sadly.
				// TODO: navigate to week note file.
			},
			navLinkHint: (...args: any[]): string => {
				// Poorly documented and typed, but args 0 is a string, and args 1 is the date object.
				// Unfortunately, this is fairly useless because there's no way to see it on mobile.
				return "wow " + JSON.stringify(args);
			},
		});
		this.calUI.addEventSource({
			id: "horizoncal", // providing an ID makes it easy to add new events later and attach them to this source (which turns out to be essential for ID-based dedup).
			events: makeEventSourceFunc(this.plugin, this.calUI),
			color: "#146792",
		});
		// this.evtsrc = this.calUI.getEventSourceById('horizoncal')! // unnecessary, because the addEvent api supports use of name.

		// Register vault change hooks.
		// If we're calling this function again for a few that's already initialized, due to the "BONK FULLCAL" button...
		//  be aware that we leaked the old listeners.  I don't see an easy way to avoid that,
		//   and the hope is that we nearly never need to press that debug button, so, I'm ignoring this problem.  It's harmless in practice.
		registerVaultChangesToCalendarUpdates(this.plugin, this, this.calUI);
	}
}
