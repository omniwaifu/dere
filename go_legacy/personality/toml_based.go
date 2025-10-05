package personality

// TOMLPersonality wraps a PersonalityConfig and implements the Personality interface
type TOMLPersonality struct {
	config *PersonalityConfig
}

func NewTOMLPersonality(config *PersonalityConfig) *TOMLPersonality {
	return &TOMLPersonality{config: config}
}

func (t *TOMLPersonality) GetPrompt() string {
	return t.config.Prompt.Content
}

func (t *TOMLPersonality) GetName() string {
	return t.config.Metadata.Name
}

func (t *TOMLPersonality) GetShortName() string {
	return t.config.Metadata.ShortName
}

func (t *TOMLPersonality) GetColor() string {
	return t.config.Display.Color
}

func (t *TOMLPersonality) GetIcon() string {
	return t.config.Display.Icon
}