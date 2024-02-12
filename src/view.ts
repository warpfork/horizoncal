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

import { dvToHCEvent } from './convert';

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
				// .query({
				// 	start: info.start.valueOf(),
				// 	end: info.end.valueOf()
				// })
				const dv = getAPI();
				const pages = dv.pages('"sys/horizoncal"')
					.where(p => String(p.file.name).startsWith("evt-"))
				//.where(p => p.file.day - weekStart >= 0 && p.file.day - weekStart < dvdur("7d")) // how does dv infer this?
				//.sort((p) => p.file.name, 'asc')
				console.log(dvToHCEvent(pages[0]))

				// Now, dataview has unfortunately done several very cursed things here.
				// It's put "file" into the objects, which is... okay, we can just remove that again.
				// But it's also put a downcased copy of all field names into the object, too.
				// That's... I don't know how to renormalize that except ask someone else to go parse the damn properties again.
				// 
				// ... The answer to this is simple.  We just know what the properties are we care about.  That's it.

				successCallback([
					{
						title: 'Event44',
						start: '2024-02-12'
					},
					dvToHCEvent(pages[0]),
				])
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
