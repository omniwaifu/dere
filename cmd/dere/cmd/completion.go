package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

// completionCmd represents the completion command
var completionCmd = &cobra.Command{
	Use:   "completion [bash|zsh|fish|powershell]",
	Short: "Generate completion script",
	Long: `Generate shell completion scripts for dere.

To get completion instructions for your current shell, run without arguments:
  $ dere completion

To generate completion for a specific shell:
  $ dere completion bash
  $ dere completion zsh
  $ dere completion fish
  $ dere completion powershell`,
	DisableFlagsInUseLine: true,
	ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
	Args:                  cobra.RangeArgs(0, 1),
	Run: func(cmd *cobra.Command, args []string) {
		if len(args) == 0 {
			// Auto-detect shell and provide smart instructions
			showSmartInstructions()
			return
		}

		// Validate shell argument
		shell := args[0]
		validShells := []string{"bash", "zsh", "fish", "powershell"}
		isValid := false
		for _, valid := range validShells {
			if shell == valid {
				isValid = true
				break
			}
		}
		if !isValid {
			fmt.Fprintf(os.Stderr, "Error: invalid shell '%s'. Valid options: %s\n", shell, strings.Join(validShells, ", "))
			os.Exit(1)
		}

		switch shell {
		case "bash":
			cmd.Root().GenBashCompletion(os.Stdout)
		case "zsh":
			cmd.Root().GenZshCompletion(os.Stdout)
		case "fish":
			cmd.Root().GenFishCompletion(os.Stdout, true)
		case "powershell":
			cmd.Root().GenPowerShellCompletionWithDesc(os.Stdout)
		}
	},
}

// showSmartInstructions detects the current shell and provides appropriate instructions
func showSmartInstructions() {
	// Detect current shell
	shell := detectShell()
	home, _ := os.UserHomeDir()

	fmt.Printf("🐚 Detected shell: %s\n\n", shell)

	switch shell {
	case "zsh":
		showZshInstructions(home)
	case "bash":
		showBashInstructions(home)
	case "fish":
		showFishInstructions(home)
	default:
		fmt.Printf("Shell '%s' not fully supported. Available options:\n", shell)
		fmt.Println("  dere completion bash")
		fmt.Println("  dere completion zsh")
		fmt.Println("  dere completion fish")
		fmt.Println("  dere completion powershell")
	}
}

// detectShell attempts to detect the current shell
func detectShell() string {
	// Check SHELL environment variable first
	if shell := os.Getenv("SHELL"); shell != "" {
		return filepath.Base(shell)
	}

	// Fallback: check parent process or common patterns
	return "unknown"
}

// showZshInstructions provides zsh-specific completion setup
func showZshInstructions(home string) {
	fmt.Println("📋 Zsh Completion Setup:")
	fmt.Println()

	// Check for common zsh completion directories
	var completionDir string
	possibleDirs := []string{
		filepath.Join(home, ".zsh", "completions"),
		filepath.Join(home, ".oh-my-zsh", "completions"),
		"/usr/local/share/zsh/site-functions",
		"/usr/share/zsh/site-functions",
	}

	for _, dir := range possibleDirs {
		if _, err := os.Stat(dir); err == nil {
			completionDir = dir
			break
		}
	}

	if completionDir == "" {
		// Create a reasonable default
		completionDir = filepath.Join(home, ".zsh", "completions")
		fmt.Printf("📁 Creating completion directory: %s\n", completionDir)
		fmt.Printf("   mkdir -p %s\n\n", completionDir)
	}

	fmt.Println("1️⃣  Install completion:")
	fmt.Printf("   dere completion zsh > %s/_dere\n\n", completionDir)

	fmt.Println("2️⃣  Add to fpath (add to ~/.zshrc if not already there):")
	fmt.Printf("   echo 'fpath=(%s $fpath)' >> ~/.zshrc\n", completionDir)
	fmt.Println("   echo 'autoload -U compinit && compinit' >> ~/.zshrc\n")

	fmt.Println("3️⃣  Reload shell:")
	fmt.Println("   source ~/.zshrc\n")

	fmt.Println("💡 Quick setup (all-in-one):")
	fmt.Printf("   mkdir -p %s && dere completion zsh > %s/_dere\n", completionDir, completionDir)
}

// showBashInstructions provides bash-specific completion setup
func showBashInstructions(home string) {
	fmt.Println("📋 Bash Completion Setup:")
	fmt.Println()

	fmt.Println("🚀 Quick test:")
	fmt.Println("   source <(dere completion bash)\n")

	fmt.Println("💾 Permanent setup:")
	if _, err := os.Stat("/etc/bash_completion.d"); err == nil {
		fmt.Println("   sudo dere completion bash > /etc/bash_completion.d/dere")
	} else {
		fmt.Println("   mkdir -p ~/.bash_completion.d")
		fmt.Println("   dere completion bash > ~/.bash_completion.d/dere")
		fmt.Println("   echo 'source ~/.bash_completion.d/dere' >> ~/.bashrc")
	}
}

// showFishInstructions provides fish-specific completion setup
func showFishInstructions(home string) {
	fmt.Println("📋 Fish Completion Setup:")
	fmt.Println()

	fishDir := filepath.Join(home, ".config", "fish", "completions")

	fmt.Println("🚀 Quick test:")
	fmt.Println("   dere completion fish | source\n")

	fmt.Printf("💾 Permanent setup:\n")
	fmt.Printf("   mkdir -p %s\n", fishDir)
	fmt.Printf("   dere completion fish > %s/dere.fish\n", fishDir)
}

func init() {
	rootCmd.AddCommand(completionCmd)
}