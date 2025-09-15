package weather

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	
	"dere/src/config"
)

type WeatherData struct {
	Temperature    float64  `json:"temperature"`
	FeelsLike      float64  `json:"feels_like"`
	Humidity       int      `json:"humidity"`
	DewPoint       float64  `json:"dew_point"`
	Precipitation  float64  `json:"precipitation"`
	Pressure       int      `json:"pressure"`
	WindSpeed      float64  `json:"wind_speed"`
	WindDirection  int      `json:"wind_direction"`
	UVIndex        *float64 `json:"uv_index"`
	Description    string   `json:"description"`
	Icon           string   `json:"icon"`
	LocationName   string   `json:"location_name"`
	Units          string   // Track units from config
}

func GetWeatherData(cfg *config.WeatherConfig) (*WeatherData, error) {
	if !cfg.Enabled {
		return nil, nil
	}
	
	// Check if rustormy is available
	_, err := exec.LookPath("rustormy")
	if err != nil {
		return nil, fmt.Errorf("rustormy not found in PATH")
	}
	
	// Build command arguments
	args := []string{"--format", "json", "--no-cache"}
	
	// Add provider if specified
	if cfg.Provider != "" {
		args = append(args, "--provider", cfg.Provider)
	}
	
	// Add location (either city or lat/lon)
	if cfg.City != "" {
		args = append(args, "--city", cfg.City)
	} else if cfg.Lat != 0 && cfg.Lon != 0 {
		args = append(args, "--lat", fmt.Sprintf("%.6f", cfg.Lat))
		args = append(args, "--lon", fmt.Sprintf("%.6f", cfg.Lon))
	} else {
		return nil, fmt.Errorf("weather location not configured (need city or lat/lon)")
	}
	
	// Add units if specified
	if cfg.Units != "" {
		args = append(args, "--units", cfg.Units)
	}
	
	// Execute rustormy
	cmd := exec.Command("rustormy", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("rustormy failed: %v (stderr: %s)", err, stderr.String())
	}
	
	// Parse JSON output
	var data WeatherData
	if err := json.Unmarshal(stdout.Bytes(), &data); err != nil {
		return nil, fmt.Errorf("failed to parse rustormy output: %v", err)
	}
	
	// Store the units from config
	data.Units = cfg.Units
	if data.Units == "" {
		data.Units = "metric" // Default to metric
	}
	
	return &data, nil
}

func FormatWeatherContext(data *WeatherData) string {
	if data == nil {
		return ""
	}
	
	var context strings.Builder
	
	// Header with location
	location := "Unknown Location"
	if data.LocationName != "" {
		location = data.LocationName
	}
	context.WriteString(fmt.Sprintf("## Current Weather: %s\n", location))
	
	// Main weather line - determine units based on config
	tempUnit := "°C"
	speedUnit := "m/s"
	precipUnit := "mm"
	if data.Units == "imperial" {
		tempUnit = "°F"
		speedUnit = "mph"
		precipUnit = "in"
	}
	
	context.WriteString(fmt.Sprintf("%s, %.1f%s (feels like %.1f%s)\n", 
		data.Description, 
		data.Temperature, tempUnit,
		data.FeelsLike, tempUnit))
	
	// Wind direction emoji
	windDir := getWindDirectionArrow(data.WindDirection)
	
	// Secondary info
	context.WriteString(fmt.Sprintf("Wind: %.1f %s %s | Humidity: %d%%\n", 
		data.WindSpeed, speedUnit, windDir, data.Humidity))
	
	// Additional info
	context.WriteString(fmt.Sprintf("Pressure: %d hPa | Precipitation: %.1f %s", 
		data.Pressure, data.Precipitation, precipUnit))
	
	// UV Index if available
	if data.UVIndex != nil {
		context.WriteString(fmt.Sprintf(" | UV Index: %.1f", *data.UVIndex))
	}
	
	context.WriteString("\n")
	
	return context.String()
}

func getWindDirectionArrow(degrees int) string {
	// Normalize to 0-360
	degrees = degrees % 360
	if degrees < 0 {
		degrees += 360
	}
	
	// Map to 8 directions
	switch {
	case degrees >= 337 || degrees < 23:
		return "↑" // North
	case degrees >= 23 && degrees < 68:
		return "↗" // North-East
	case degrees >= 68 && degrees < 113:
		return "→" // East
	case degrees >= 113 && degrees < 158:
		return "↘" // South-East
	case degrees >= 158 && degrees < 203:
		return "↓" // South
	case degrees >= 203 && degrees < 248:
		return "↙" // South-West
	case degrees >= 248 && degrees < 293:
		return "←" // West
	case degrees >= 293 && degrees < 337:
		return "↖" // North-West
	default:
		return "?"
	}
}