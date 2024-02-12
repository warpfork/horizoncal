import {
	App,
	Modal,
	Plugin,
	WorkspaceLeaf
} from 'obsidian';

import { DEFAULT_SETTINGS, HorizonCalSettings, HorizonCalSettingsTab } from './settings';
import { HorizonCalView, VIEW_TYPE } from './view';

export default class HorizonCalPlugin extends Plugin {
	settings: HorizonCalSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('calendar-glyph', 'Open Horizon Calendar', (evt: MouseEvent) => {
			//new Notice('This is a notice!');
			this._activateCalendarView(evt.shiftKey);
		});
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// Views!  This is what I'm here for.
		this.registerView(
			VIEW_TYPE,
			(leaf) => new HorizonCalView(leaf)
		);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new HorizonCalSettingsTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {
		// One could do this.  But let's not :)
		// Turns out that because we used `registerView` earlier,
		// obsidian is clever and already puts nice tombstones in place when the plugin goes away.
		// And in dev iteration, *I don't want these closed* every time I reload.
		// ... Oh look, that's even recommended: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Don't+detach+leaves+in+%60onunload%60
		//this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// All the function names above are magical.

	async _activateCalendarView(forceNew: boolean) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);

		if (forceNew || leaves.length < 1) {
			// TODO right sidebar is... not what I want.  What's the "main" leaf?
			leaf = workspace.getLeaf();
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		} else {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!  Really.');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
