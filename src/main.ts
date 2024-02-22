import {
	Plugin,
	WorkspaceLeaf
} from 'obsidian';

import { DEFAULT_SETTINGS, HorizonCalSettings, HorizonCalSettingsTab } from './settings/settings';
import { HorizonCalView, VIEW_TYPE } from './ui/calendarview';

export default class HorizonCalPlugin extends Plugin {
	settings: HorizonCalSettings;

	async onload() {
		await this.loadSettings();

		// Make the calendar openable in a couple of ways:
		// a ribbon button, and a pair of commands.
		//
		// The ribbon button can secretly be shift-clicked to force opening another new view on desktop.
		// In order to make that possible on mobile, we add a command with equivalent behavior.
		this.addRibbonIcon('calendar-glyph', 'Open Horizon Calendar', (evt: MouseEvent) => {
			this._activateCalendarView(evt.shiftKey);
		});
		this.addCommand({
			id: 'hc-open-calendar',
			name: 'Open Calendar View',
			callback: () => {
				this._activateCalendarView(false);
			}
		});
		this.addCommand({
			id: 'hc-open-new-calendar',
			name: 'Open New Calendar View',
			callback: () => {
				this._activateCalendarView(true);
			}
		});

		// Views!  This is what I'm here for.
		this.registerView(
			VIEW_TYPE,
			(leaf) => new HorizonCalView(this, leaf)
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new HorizonCalSettingsTab(this.app, this));
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


		// Which leaf style to use... depends.
		//  - On mobile, by default: we want to use the `rightSplit` if it's `WorkspaceMobileDrawer`.
		//     This is because mobile can't really do splits in the main tree, and tab switching is relatively high-effort.
		//  - On desktop, by default: opening it in one tab in the main tree is fine; we have plenty of space.
		//     And switching to an already-existing view is _probably_ the right thing to do, _most_ of the time.
		//  - On desktop, if you ask for a new view: you should get it.  Period.
		//  - On mobile, if you ask for a new view: well, now you're getting it in the main tree.
		//
		// FUTURE: make a distinction between the main and secondary ones, and make the main one persist its date view range.
		//
		// FIXME: this is grabbing the currently active leaf on desktop, and it should never do that,
		// because we disable nav on this tab, and that means you can't go _back_ either.

		let leaf: WorkspaceLeaf | null = null;
		if (forceNew) {
			leaf = workspace.getLeaf("tab");
		} else if (workspace.rightSplit.type == "mobile-drawer") {
			leaf = workspace.getRightLeaf(false);
		} else {
			const leaves = workspace.getLeavesOfType(VIEW_TYPE);
			if (leaves.length > 0) {
				// A leaf with our view already exists, use that
				leaf = leaves[0];
			} else {
				// Get a new one.
				leaf = workspace.getLeaf("tab");
			}
		}
		await leaf.setViewState({ type: VIEW_TYPE, active: true });

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}
}

// wishlist: also add an editor integration that adds some extra rendering to event files,
// which visualizes things like whether the event's TZ is in your prevailing TZ or a different one, etc.
