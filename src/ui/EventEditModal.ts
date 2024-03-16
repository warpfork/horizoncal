import {
	KeymapContext,
	Modal,
	Setting,
	TFile,
	ToggleComponent,
} from 'obsidian';

import { HCEvent, HCEventFilePath } from "../data/data";
import { Control } from "../data/datacontrol";
import HorizonCalPlugin from "../main";
import { openEventInEditor } from './openEditor';

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

	categoriesEl: HTMLElement; // initialized onOpen, stored so a CategorySelectModal can grab it to update it.

	onOpen() {
		this._defragilify();

		let { contentEl, containerEl } = this;
		containerEl.addClass("horizoncal");
		containerEl.addClass("hc-evt-edit-modal");
		if (this.data.loadedFrom) {
			contentEl.createEl("h1", { text: "Edit event" });
		} else {
			contentEl.createEl("h1", { text: "New event" });
		}

		// Alt-o means "okay".
		this.scope.register(['Alt'], 'o', (evt: KeyboardEvent, ctx: KeymapContext) => {
			this._onSubmit();
		})

		let widgeteer = <TStructured>(params: {
			// Consider it constrained that "TStructured as DateTime, when type=='date'".
			// (I think that could be done with a sufficiently massive union type,
			// but I'm not really sure it's worth it :))
			// (... huh, ends up not mattering, because we successfully only handle raws here.  nice.)
			prop: Control<string | undefined, TStructured>
			name: string
			desc?: string
			type: "text" | "date" | "time" | "toggle"
		}) => {
			let setting = new Setting(contentEl)
			setting.setName(params.name)
			switch (params.type) {
				case "text":
					setting.addText((comp) => comp
						.setValue(params.prop.valuePrimitive!)
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
						{ type: "date", value: params.prop.valuePrimitive },
						(el) => {
							el.addEventListener('change', () => {
								let err = params.prop.tryUpdate(el.value)
								el.toggleClass("invalid", !!err)
							});
						});
					break;
				case "time":
					setting.controlEl.createEl("input",
						{ type: "time", value: params.prop.valuePrimitive },
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

		new Setting(contentEl)
			.setName("categories!")
			.addButton((btn) => {
				btn.onClick(() => new CategorySelectModal(this).open())
			}).controlEl.createEl("span", {}, (el) => {
				// TODO this needs style.  like, a lot.
				el.setText(this.data.evtCat.valueStructured + "");
				// Store it so it's mutable.  The CategorySelectModal will live-update it.
				this.categoriesEl = el;
			})

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
				btn.setIcon("clipboard");
				btn.setTooltip("Save and Edit");
				btn.setClass("save");
				btn.onClick(async () => {
					await this._onSubmit();
					await openEventInEditor(this.plugin, this.data);
				});
				return btn;
			})
			.addButton(btn => {
				btn.setIcon("checkmark");
				btn.setTooltip("Save");
				btn.setClass("save");
				btn.onClick(async () => {
					await this._onSubmit();
				});
				return btn;
			})
			.addButton(btn => {
				btn.setIcon("cross");
				btn.setTooltip("Cancel");
				btn.setClass("cancel");
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
			let path = HCEventFilePath.fromEvent(this.data);
			try {
				// Wrapped in a `try` because it throws on "already exists", which is not a real problem.
				// Might be worth inspecting the error and reacting better if it's something else,
				// but the file creation attempt up next should return a meaningful error in most cases anyway.
				await this.plugin.app.vault.createFolder(`${this.plugin.settings.prefixPath}/${path.dirs}`)
			} catch { }
			// FIXME: file-already-exists should be handled in a less awful way.
			//  Right now, we balk, and don't do anything destructive (on disk nor in UI), but it doesn't offer good guidance.
			try {
				file = await this.app.vault.create(`${this.plugin.settings.prefixPath}/${path.wholePath}`, "")
			} catch (error) {
				alert("Error: could not create new event file -- " + error
					+ "\n\nPick a title for the event that's unique in its day!");
				return
			}
			this.data.loadedFrom = file.path;
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


export class CategorySelectModal extends Modal {
	constructor(parent: EventEditModal) {
		super(parent.app);
		this.parent = parent;
	}

	private parent: EventEditModal;


	onOpen() {
		this.containerEl.addClass("horizoncal");
		this.containerEl.addClass("hc-category-selection-modal");  // Main purpose is CSS to shrink it a bit.

		// The set of options we'll render is the union of categories known in the config and anything previously here.
		let options: string[] = []
		options.push(...Object.keys(this.parent.plugin.settings.categories));
		options.push(...this.parent.data.evtCat.valueStructured);
		options.sort(); // TODO may want to flag these as originating from non-settings or not.  Visually.
		options = options.unique();

		// Someday todo: i'd probably like to have the arrow keys, and pgup/pgdown, move the nav focus too.

		// Alt-o means "okay".
		this.scope.register(['Alt'], 'o', (evt: KeyboardEvent, ctx: KeymapContext) => {
			// No additional persistence efforts required in this one.  It's accumulating in-memory mutations.
			this.close();
		})

		this.contentEl.createEl("ul", {}, (el) => {
			options.forEach((row) => {
				el.createEl("li", {}, (el) => {
					new Setting(el)
						.setName(row)
						.addToggle((tog: ToggleComponent) => {
							tog.setValue(this.parent.data.evtCat.valueStructured.contains(row));
							tog.onChange((on: boolean) => {
								let prev = this.parent.data.evtCat.valuePrimitive
								let next = [...prev]
								if (on) {
									next.push("#evt/" + row)
								} else {
									next.remove("#evt/" + row)
								}
								this.parent.data.evtCat.update(next)
								this.parent.categoriesEl.setText(this.parent.data.evtCat.valueStructured + ""); // TODO: make a more coherent element here, with an update method.
							});
						})
				})
			})
		})
	}
}
