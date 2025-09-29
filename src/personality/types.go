package personality

type PersonalityConfig struct {
	Metadata MetadataConfig `toml:"metadata"`
	Display  DisplayConfig  `toml:"display"`
	Prompt   PromptConfig   `toml:"prompt"`
}

type MetadataConfig struct {
	Name      string   `toml:"name"`
	ShortName string   `toml:"short_name"`
	Aliases   []string `toml:"aliases"`
}

type DisplayConfig struct {
	Color string `toml:"color"`
	Icon  string `toml:"icon"`
}

type PromptConfig struct {
	Content string `toml:"content"`
}