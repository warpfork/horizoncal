import {
	Modal,
	Setting,
} from 'obsidian';

import { HCEvent, HCEventFilePath } from "../data/data";
import { Control } from "../data/datacontrol";
import { HorizonCalView } from "./calendarview";

// TODO: with very little additional work, this doesn't have to be just for "new" events :)
// TODO: not sure if the parent of this is actually the calendar view; we could launch this from an event file, too, as an alternative to the plain properties editor.

export class NewEventModal extends Modal {
	constructor(parentView: HorizonCalView, data: HCEvent) {
		super(parentView.plugin.app);
		this.data = data;
		this.parentView = parentView;
	}

	parentView: HorizonCalView;
	data: HCEvent;

	onOpen() {
		this._defragilify();
		this._style();

		let { contentEl } = this;
		contentEl.createEl("h1", { text: "New event" });

		let widgeteer = <TParsed>(params: {
			// Consider it constrained that "TParsed as DateTime, when type=='date'".
			// (I think that could be done with a sufficiently massive union type,
			// but I'm not really sure it's worth it :))
			// (... huh, ends up not mattering, because we successfully only handle raws here.  nice.)
			prop: Control<string | undefined, TParsed>
			name: string
			desc?: string
			type: "text" | "date" | "time" | "toggle"
		}) => {
			let setting = new Setting(contentEl)
			setting.setName(params.name)
			switch (params.type) {
				case "text":
					setting.addText((comp) => comp
						.setValue(params.prop.valueRaw!)
						.onChange((value) => {
							let err = params.prop.tryUpdate(value)
							if (err) {
								// TODO visually highlight as invalid
							}
						}));
					break;
				case "date":
					setting.controlEl.createEl("input",
						// Unfortunate fact about date elements: they use the brower's locale for formatting.
						// I don't know how to control that in electron.  I don't think it's possible.
						// (I appreciate the user-choice _concept_ there, but in practice... system locale is a PITA to control and I don't think this plays out in the user's favor in reality.)
						{ type: "date", value: params.prop.valueRaw },
						(el) => {
							el.addEventListener('change', () => {
								let err = params.prop.tryUpdate(el.value)
								if (err) {
									// TODO visually highlight as invalid
								}
							});
						});
					break;
				case "time":
					setting.controlEl.createEl("input",
						{ type: "time", value: params.prop.valueRaw },
						(el) => {
							el.addEventListener('change', () => {
								let err = params.prop.tryUpdate(el.value)
								if (err) {
									// TODO visually highlight as invalid
								}
							});
						});
					break;
				case "toggle":
					break;
			}
		};

		widgeteer({
			prop: this.data.title, // TODO okay wasn't really planning to Control'ify EVERYTHING but... it makes mutation widget wiring easier too.
			name: "Title",
			type: "text",
		});

		widgeteer({
			// Leaving evtType as freetext for now, but
			// want to introduce a more complex feature here,
			// probably with a sub-modal.
			// May also turn into a set that's persisted as comma-sep strings.
			prop: this.data.evtType, // TODO okay wasn't really planning to Control'ify EVERYTHING but... it makes mutation widget wiring easier too.
			name: "Event Type",
			type: "text",
		});

		// FUTURE: we might wanna do some custom style around date and time things..
		// The date related stuff should have reduced borders and margins between them.
		// (Timezone might also deserve a fold to hide it, but I don't know how to do that with graceful accessibility yet.)
		// (Timezone might ALSO deserve an autocomplete widget of some kind, but that's also beyond me today.)
		widgeteer({
			prop: this.data.evtDate,
			name: "Event Date",
			type: "date",
		});
		widgeteer({
			prop: this.data.evtTime,
			name: "Event Time",
			type: "time",
		});
		widgeteer({
			prop: this.data.evtTZ,
			name: "Timezone",
			type: "text",
		});

		// And now again, the date and time and zone stuff, for ending.
		widgeteer({
			prop: this.data.endDate,
			name: "Event End Date",
			type: "date",
		});
		widgeteer({
			prop: this.data.endTime,
			name: "Event End Time",
			type: "time",
		});
		widgeteer({
			prop: this.data.endTZ,
			name: "Event End Timezone",
			type: "text",
		});

		new Setting(contentEl)
			.addButton(btn => {
				btn.setIcon("checkmark");
				btn.setTooltip("Save");
				btn.onClick(async () => {
					await this._onSubmit();
					this.close();
				});
				return btn;
			})
			.addButton(btn => {
				btn.setIcon("cross");
				btn.setTooltip("Cancel");
				btn.onClick(() => {
					this.close();
				});
				return btn;
			});
	}

	_defragilify() {
		// Remove the background div with a click handler that closes the modal.
		// Closing modals accidentally with a stray click should not be so easy;
		// as a user, I very _very_ rarely want the majority of clickable screen area
		// to turn into a "silently throw away my data" action.
		//
		// If there were more params provide to `onClose` that we could disambiguate close types,
		// and possibly prompt for confirmation, I would have less beef.
		// Since there's not: yeah, nuke this entire trap.
		//
		// Fortunately, the handler we want to get rid of is on its entire own node.
		// It appears to always be the first child, but we'll do a class check
		// just to be on the safe side.
		for (var i = 0; i < this.containerEl.children.length; i++) {
			let child = this.containerEl.children[i];
			if (child.hasClass("modal-bg")) { child.remove() }
		}
	}
	_style() {
		// I have capricious opinions.
		this.modalEl.setCssStyles({ border: "2px solid #F0F" })
		// We need *some* background color on the container, because we nuked the default fadeout during defragilify.
		// The default would be more like `{ backgroundColor: "var(--background-modifier-cover)" }`, but let's have some fun anyway.
		this.containerEl.setCssStyles({ backgroundColor: "#000022cc" })
	}
	async _onSubmit() {
		// FIXME are you sure it's valid? :D

		let path = HCEventFilePath.fromEvent(this.data);

		let file = await this.app.vault.create("sys/horizoncal/" + path.wholePath, "")

		await this.app.fileManager.processFrontMatter(file, (fileFm: any): void => {
			this.data.foistFrontmatter(fileFm);
			// Persistence?
			// It's handled magically by processFrontMatter as soon as this callback returns:
			//  it persists our mutations to the `fileFm` argument.
		});

		// There is a remarkable lack of UI bonking here.
		// We simply wait for the filesystem change events to cause the new data to come back to the UI.
	}

	onClose() {
		let { contentEl } = this;

		// No persistence unless you clicked our submit button.
		//
		// We made considerable effort to make sure accidental modal dismissal
		// is unlikely even on desktop (which by default is otherwise a bit treacherous),
		// so dropping data when we get here seems safe and reasonable to do.
		contentEl.empty();
	}
}
