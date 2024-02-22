
import {
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
		let { contentEl, containerEl } = this;
		containerEl.addClass("horizoncal");

		contentEl.createEl("h3", { text: "viewing event" });
		
		// TODO display: event title and basic facts
		// TODO button: edit event with tool
		// TODO button: go to editor
		// TODO button: delete event
		// TODO button: close / cancel
	}
}
