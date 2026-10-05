# GitHub Release Checklist

## Already cleaned in this package

- Removed `node_modules`, `.expo`, and local editor/cache folders
- Removed stale duplicate financial-context code
- Removed the unreachable legacy Recurring Income screen/route
- Removed unused legacy image assets
- Removed the unused `rn-tourguide` dependency/provider
- Removed an obsolete `app_tour_state` write
- Replaced remaining old Rylie / generic Financial AI branding with Pengpeng
- Updated the optional AI backend prompt to the Pengpeng identity
- Updated the README for Expo SDK 57 and the final first-run flow
- Converted the Pengpeng launcher icon to a production-friendly 1024×1024 PNG
- Verified local relative imports resolve
- Scanned source/config for obvious embedded API keys or bearer tokens
- Validated Expo static config
- Successfully generated an Android Expo export bundle from the cleaned source
- Refreshed `package-lock.json`; npm audit reported 0 vulnerabilities during cleanup

## Before publishing

1. Extract this project into its own folder.
2. Run:

   ```bash
   npm install
   npm run doctor
   npx expo start -c
   ```

3. Do one final device launch and confirm:
   - Splash → App Tour → Profile Onboarding → Home on fresh app data
   - Splash → Home on later opens
   - wallet / bill / Pengpeng / profile actions still work
4. Add final screenshots to `docs/screenshots/`.
5. Do not commit a real `.env` file or provider API key.
6. Create a new GitHub repository, for example `pengpeng-expense-tracker`.
7. Commit the cleaned project and push.

## Suggested first commit

```text
feat: publish Pengpeng smart AI expense tracker
```
