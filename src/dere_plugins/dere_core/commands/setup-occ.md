---
description: Interactive psychological quiz to create or update user's OCC emotion profile
---

## Context

You are setting up the user's OCC (Ortony, Clore, Collins) emotion profile. This profile helps the bot recognize the user's emotional state during conversations based on their personal goals, standards, and attitudes.

The profile will be saved to `~/.config/dere/user_occ.json` and used by the emotion recognition system.

## Your Task

1. **Check for existing profile:**
   - Read `~/.config/dere/user_occ.json` if it exists
   - If it exists, ask if they want to update it or start fresh

2. **Quiz the user about their psychology:**

   Use `AskUserQuestion` to ask about:

   **A. Goals (What matters to them):**
   - Ask: "What matters most to you in daily life?"
   - Options: Getting things done efficiently, Understanding things deeply, Helping others, Being creative, Maintaining balance and peace, Learning and growing
   - Allow multiSelect: true

   **B. Standards (What makes them proud/ashamed):**
   - Ask: "What makes you feel proud of yourself?"
   - Options: Being reliable and keeping commitments, Treating people with kindness, Standing up for what I believe in, Solving difficult problems, Being honest and authentic, Never giving up
   - Allow multiSelect: true

   **C. Attitudes (How they feel about common situations):**
   - Ask multiple questions with single select for each:
     - "How do you feel about unexpected challenges?" (Exciting opportunity / Manageable / Stressful / Overwhelming)
     - "How do you feel about asking for help?" (Natural and easy / Fine when needed / Uncomfortable / Avoid it)
     - "How do you feel about trying new things?" (Love novelty / Open minded / Prefer familiar / Resist change)

3. **Generate the JSON config:**

   Based on their answers, create a `user_occ.json` file with this structure:

   ```json
   {
     "version": "1.0",
     "created_at": "2025-01-15T10:30:00Z",
     "updated_at": "2025-01-15T10:30:00Z",
     "goals": [
       {
         "id": "accomplish_things",
         "description": "Complete tasks and get things done",
         "active": true,
         "importance": 9
       }
     ],
     "standards": [
       {
         "id": "be_reliable",
         "description": "Be reliable and keep commitments",
         "importance": 8,
         "praiseworthiness": 8
       }
     ],
     "attitudes": [
       {
         "id": "challenges",
         "target_object": "unexpected_challenges",
         "description": "Attitude toward unexpected challenges",
         "appealingness": -3
       }
     ]
   }
   ```

   **Mapping guidelines:**
   - Importance: 10 = extremely important, 5 = moderately important, 1 = not very important
   - Praiseworthiness: 10 = highly praiseworthy, -10 = blameworthy
   - Appealingness: 10 = very appealing, 0 = neutral, -10 = very unappealing

4. **Save the file:**
   - Use the Write tool to save to `~/.config/dere/user_occ.json`
   - Inform the user their profile has been created/updated
   - Explain that the emotion system will now recognize their emotional state based on this profile

## Important Notes

- Be conversational and explain what you're doing
- Map their answers thoughtfully to OCC constructs
- The profile tracks the USER'S psychology, not the bot's
- This is used for emotion RECOGNITION, not simulation
