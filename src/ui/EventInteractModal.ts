
import {
	ButtonComponent,
	Modal,
	TFile,
	ToggleComponent,
	WorkspaceLeaf
} from 'obsidian';

import { HCEvent } from "../data/data";
import HorizonCalPlugin from "../main";
import { EventEditModal } from './EventEditModal';

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
					let hcEvtOrError = HCEvent.fromPath(this.app, this.data.loadedFrom!);
					if (hcEvtOrError instanceof Error) {
						alert("event file disappeared!");
						this.close();
						return
					}
					let hcEvt: HCEvent = hcEvtOrError;
					new EventEditModal(this.plugin, hcEvt).open();
					this.close();
				})
		})
		contentEl.createDiv({ cls: "control-wide" }, (el) => {
			new ButtonComponent(el).setButtonText("open in markdown editor")
				.onClick((evt) => {
					// We're gonan do a couple searches to find the least-surprsing place to open this.
					//
					// - If there's an existing editor pane open to that file: just focus it.
					// - If we have to open one: *prefer to do it as a tab next to anything else open in the horizoncal dir*.
					// - If no editors are open to that zone at all, we're going to create a new split,
					//    so that they end up visually near the calendar, and don't cause the calendar to totally disappear.
					//    (On mobile, this has a much more limited effect: the tabs drawer gets a divider line in it.  Views are still fullscreen.)
					let foundExisting = false
					let sameZone: WorkspaceLeaf | undefined;
					this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
						const viewState = leaf.getViewState()

						// Only interested in markdown editor views.
						if (viewState.type !== 'markdown') return;

						// If we find an exact match?  Great, focus it, and we're done.
						if (viewState.state?.file === this.data.loadedFrom) {
							this.app.workspace.setActiveLeaf(leaf, { focus: true })
							foundExisting = true
							return
						}

						// If it's... close?  Keep a finger on it; we might use it.
						if (viewState.state?.file.startsWith(this.plugin.settings.prefixPath)) {
							sameZone = leaf
						}
					})
					if (!foundExisting) {
						let file = this.app.vault.getAbstractFileByPath(this.data.loadedFrom!)
						if (!file || !(file instanceof TFile)) {
							alert("event file disappeared!");
							this.close();
							return
						}
						let targetLeaf: WorkspaceLeaf;
						if (sameZone) {
							// The API for creating new leaves is a little interesting.
							//
							// You can generally only ask the workspace to give you a new leaf relative to existing ones.
							//  - `getLeaf` makes new ones relevant to the active leaf
							//      ... so you have to _set the active leaf_ first if you want to control it;
							//      {PaneType} is functionally the only parameter.
							//  - `duplicateLeaf` offers a little more control --
							//      {orientationLeaf, PaneType, SplitDirection?}.
							//      Of course, it also has an effect of loading up the entire view of that leaf.
							//       So, if it was open as an editor, you get... another one.
							//       Even if all you want to do is immediately navigate away.
							//       (This shows up in the tab's history nav, also!  Not just the first page, but the WHOLE history stack!)
							//      Oh, and 'duplicateLeaf' returns a promise, unlike most of the neighbors which are synchronous.
							//       (I assume that's beacuse spawning a whole view inside it may be async?  Unclear.)
							//      Oh, AND, lol, the leaf parameter isn't actually for where to orient.  It's for what to copy.
							//       This thing still opens relative to the active leaf.  Sheesh.
							//  - `createLeafBySplit` offers slightly different options --
							//      {orientationLeaf, SplitDirection, before?: boolean}
							//       apparently PaneType is defacto hardcoded to 'split' with this one,
							//       but as a consolation prize, you get that 'before' boolean.
							//      Also unlike `duplicateLeaf`, it literally offers like, any control at all over where things go.
							// And there's a couple more deprecated options like "splitActiveLeaf", but no relevance of those.
							// Also, "createLeafInParent" exists, but danged if I can guess how that's meant to be used.
							//
							// So that's quite a jungle of options.  Twisty little passages, all not quite alike.
							//
							// And in all that, _I can't find an option for making new tabs as a sibling of something_...
							// Unless you hack it, but setting active leaf first.  Lordie.
							console.log("creating sibling leaf of", sameZone)
							// targetLeaf = await this.plugin.app.workspace.duplicateLeaf(sameZone, 'tab') // not at all correct; does not control position, and brings along massive state.
							// targetLeaf = this.plugin.app.workspace.createLeafBySplit(sameZone) // kinda DTRT but iff you want split; no tab option.
							// Okay.  hacks it is.
							this.plugin.app.workspace.setActiveLeaf(sameZone)
							targetLeaf = this.plugin.app.workspace.getLeaf('tab')
						} else {
							// If there are no other relevant views already open: we're going to make a new split for you.
							// Since my typical usage is timegrid, ditching vertical space is fine (but losing width would cause a jarring repaint),
							// so we'll use a "horizonal" split (horizonal refers to the line that will appear, apparently).
							targetLeaf = this.plugin.app.workspace.getLeaf('split', 'horizontal')
						}
						targetLeaf.openFile(file, { active: true });
					}
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
