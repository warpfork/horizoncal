import {
	Modal,
	Setting,
	TFile,
} from 'obsidian';

import { HCEvent, HCEventFilePath } from "../data/data";
import { Control } from "../data/datacontrol";
import HorizonCalPlugin from "../main";

//
// If the given HCEvent has its `loadedFrom` property set,
// we assume we're editing an existing event, and some text changes to match.
// If `loadedFrom` is not set, we will create a new file before saving.
// If `loadedFrom` is not set, but the computed destination filename exists
// TODO sure you can kick that can down the road again, but really?
export class EventEditModal extends Modal {
	constructor(plugin: HorizonCalPlugin, data: HCEvent) {
		super(plugin.app);
		this.plugin = plugin;
		this.data = data;
	}

	plugin: HorizonCalPlugin;
	data: HCEvent;

	onOpen() {
		this._defragilify();
		this._style();

		let { contentEl, containerEl } = this;
		containerEl.addClass("horizoncal");
		if (this.data.loadedFrom) {
			contentEl.createEl("h1", { text: "Edit event" });
		} else {
			contentEl.createEl("h1", { text: "New event" });
		}

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
							comp.inputEl.toggleClass("invalid", !!err)
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
								el.toggleClass("invalid", !!err)
							});
						});
					break;
				case "time":
					setting.controlEl.createEl("input",
						{ type: "time", value: params.prop.valueRaw },
						(el) => {
							el.addEventListener('change', () => {
								let err = params.prop.tryUpdate(el.value)
								el.toggleClass("invalid", !!err)
							});
						});
					break;
				case "toggle":
					break;
			}
		};

		widgeteer({
			prop: this.data.title,
			name: "Title",
			type: "text",
		});

		widgeteer({
			// Leaving evtType as freetext for now, but
			// want to introduce a more complex feature here,
			// probably with a sub-modal.
			// May also turn into a set that's persisted as comma-sep strings.
			prop: this.data.evtType,
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
		// Check validation again.
		// The UI should've already highlighted invalid fields,
		// but if you still clicked go, you need a kick in the shins.
		// This seems like a rare case of "alert is actually the right UX".
		let error = this.data.validate();
		if (error) {
			alert(error)
			return
		}

		let file: TFile;
		if (this.data.loadedFrom) {
			let probFile = this.app.vault.getAbstractFileByPath(this.data.loadedFrom!)
			if (!probFile || !(probFile instanceof TFile)) {
				alert("this was intended to be an edit dialog, but the original file disappeared!")
				return
			}
			file = probFile
		} else {
			// FIXME: file-already-exists comes up here as a thrown exception.  It should at least be reported better.
			let path = HCEventFilePath.fromEvent(this.data);
			file = await this.app.vault.create(`${this.plugin.settings.prefixPath}/${path.wholePath}`, "")
		}

		await this.app.fileManager.processFrontMatter(file, (fileFm: any): void => {
			this.data.foistFrontmatter(fileFm);
			// Persistence?
			// It's handled magically by processFrontMatter as soon as this callback returns:
			//  it persists our mutations to the `fileFm` argument.
		});

		// And we're done.  This modal can go away.
		this.close();

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
