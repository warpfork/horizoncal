
import {
	ButtonComponent,
	Modal
} from 'obsidian';

import { HCEvent } from "../data/data";
import HorizonCalPlugin from "../main";

// This is the first modal that pops up when you click or tap an _existing_ event.
//
// Its job is to *take up less than the full screen* (even on mobile!)
// while offering you the choice of whether to
// edit tersely (with the EventEditModal),
// or navigate to the whole event file with a full editor,
// or just cancel and return to the calendar.
// It also offers deletion, because taking you through to the edit
// view before offering that seems silly.
//
// It has no inputs, because it's meant to be easy to fearlessly dismiss.
export class EventInteractModal extends Modal {
	constructor(plugin: HorizonCalPlugin, data: HCEvent) {
		super(plugin.app);
		this.plugin = plugin;
		this.data = data;
	}

	plugin: HorizonCalPlugin;
	data: HCEvent;

	onOpen() {
		let { titleEl, contentEl, containerEl } = this;
		containerEl.addClass("horizoncal", "hc-evt-interact-modal");

		titleEl.createSpan({ text: "viewing event:" });
		titleEl.createEl("h4", { text: this.data.title.valueRaw });
		// TODO display: slightly more basic facts

		contentEl.createDiv({}, (el) => {
			new ButtonComponent(el).setButtonText("edit event")
		})
		contentEl.createDiv({}, (el) => {
			new ButtonComponent(el).setButtonText("open in markdown editor")
		})
		contentEl.createDiv({}, (el) => {
			// TODO put a toggle next to this so it requires two clicks (but doesn't produce yet another modal).
			new ButtonComponent(el).setButtonText("delete event").setWarning()
				.onClick((evt) => { alert("just kidding!  not supported yet") })
		})
		contentEl.createDiv({}, (el) => {
			new ButtonComponent(el).setIcon("back").setButtonText("cancel")
				.onClick((evt) => { this.close(); })
		})
	}
}
