package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

const version = "0.1.0"

// versionCmd represents the version command
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version number of dere",
	Long:  `Print the version number of dere`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("dere v%s\n", version)
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}