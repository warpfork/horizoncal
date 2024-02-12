import {
	App,
	ItemView,
	Modal,
	Plugin, PluginSettingTab, Setting,
	WorkspaceLeaf
} from 'obsidian';

interface HorizonCalSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: HorizonCalSettings = {
	mySetting: 'default'
}

const VIEW_TYPE = "horizoncal-view";

export default class HorizonCalPlugin extends Plugin {
	settings: HorizonCalSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Open Horizon Calendar', (evt: MouseEvent) => {
			//new Notice('This is a notice!');
			this.activateView(evt.shiftKey);
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
		this.addSettingTab(new HorizonCalSettingsTabMain(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// All the function names above are magical.

	async activateView(forceNew: boolean) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);

		if (forceNew || leaves.length < 1) {
			// TODO right sidebar is... not what I want.  What's the "main" leaf?
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		} else {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}
}

import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

export class HorizonCalView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "Horizon Calendar";
	}

	calUI: Calendar;

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl("h4", { text: "Horizon Calendar" });
		const rootNode = container.createEl("div", { cls: "horizoncal" });

		this.calUI = new Calendar(rootNode, {
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
			eventSources: [
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
				}
			],
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

	async onResize(): void {
		this.calUI.render() // `updateSize()` might be enough, but, abundance of caution.
	}

	async onClose() {
		// Nothing to clean up.
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

class HorizonCalSettingsTabMain extends PluginSettingTab {
	plugin: HorizonCalPlugin;

	constructor(app: App, plugin: HorizonCalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
