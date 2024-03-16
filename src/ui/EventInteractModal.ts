
import {
	ButtonComponent,
	Modal,
	TFile,
	ToggleComponent
} from 'obsidian';

import { HCEvent } from "../data/data";
import HorizonCalPlugin from "../main";
import { EventEditModal } from './EventEditModal';
import { openEventInEditor } from './openEditor';

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
		titleEl.createEl("h4", { text: this.data.title.valuePrimitive });
		// TODO display: slightly more basic facts

		contentEl.createDiv({ cls: "control-wide" }, (el) => {
			new ButtonComponent(el).setButtonText("edit event")
				.onClick((evt) => {
					new EventEditModal(this.plugin, this.data).open();
					this.close();
				})
		})
		contentEl.createDiv({ cls: "control-wide" }, (el) => {
			new ButtonComponent(el).setButtonText("open in markdown editor")
				.onClick(async (evt) => {
					openEventInEditor(this.plugin, this.data);
					this.close();
				})
		})
		contentEl.createDiv({ cls: "control-wide" }, (el) => {
			// A saftey togg toggle next to the delete button makes it so two clicks are required
			// (without introducing yet another modal).  Debatable if this is the prettier way or not, but it does the trick.
			let toggle = new ToggleComponent(el);
			toggle.toggleEl.addClass("delete-safety");
			let button = new ButtonComponent(el).setButtonText("delete event").setDisabled(true).setWarning()
				.onClick((evt) => {
					let file = this.app.vault.getAbstractFileByPath(this.data.loadedFrom!)
					if (!file || !(file instanceof TFile)) {
						this.close();
						return
					}
					this.app.vault.delete(file);
					this.close();
				})
			toggle.onChange((val: boolean) => {
				button.setDisabled(!val);
			})
		})
		contentEl.createDiv({ cls: "control-wide" }, (el) => {
			new ButtonComponent(el).setIcon("back").setButtonText("cancel")
				.onClick((evt) => { this.close(); })
		})
	}
}
