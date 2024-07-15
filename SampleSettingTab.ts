import MyPlugin, { Settings } from "main";
import { PluginSettingTab, App, Setting } from "obsidian";

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		//iterate over the settings and create boxes for them
		const settings = Object.keys(this.plugin.settings);

		settings.forEach((setting) => {
			new Setting(containerEl)
				.setName(setting)
				.setDesc(`Enter your ${setting}`)
				.addText((text) =>
					text
						.setPlaceholder(`Enter your ${setting}`)
						.setValue(
							this.plugin.settings[setting as keyof Settings]
						)
						.onChange(async (value) => {
							this.plugin.settings[setting as keyof Settings] =
								value;
							await this.plugin.saveSettings();
						})
				);
		});
	}
}
