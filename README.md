# Bid Database

A comprehensive web-based application for managing and analyzing construction bid events.

## Features

- **Project Management**: Create and track multiple construction projects
- **Bid Tab Upload**: Automatically parse Excel bid tabulations
- **Package Tracking**: Monitor bid packages with metrics (low/median/high/average)
- **Manual Package Entry**: Add estimated packages for future bid events
- **Bidder Normalization**: Track bidder performance across projects
- **Cross-Project Analytics**: View aggregate metrics by CSI division
- **Project Comparison**: Compare metrics and bid mix across multiple projects side-by-side
- **Shared Edit Key**: Require a shared passphrase before any data can be added, edited, or deleted
- **Cost/SF Analysis**: Calculate and track cost per square foot metrics

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm

### Setup on Raspberry Pi

1. **Copy files to your Raspberry Pi** (e.g., to `/home/pi/bid-database`)

2. **Install dependencies**:
   ```bash
   cd /home/pi/bid-database
   npm install express sql.js multer xlsx cors --break-system-packages
   ```

3. **Start the server**:
   ```bash
   EDIT_KEY="your-shared-key" node server.js
   ```

4. **Access the application**:
   Open a browser and navigate to `http://localhost:3000` (or `http://[your-pi-ip]:3000` from other devices on your network)

### Running as a Service (Optional)

To keep the server running permanently, you can set it up as a systemd service:

1. Create a service file:
   ```bash
   sudo nano /etc/systemd/system/bid-database.service
   ```

2. Add the following content:
   ```ini
   [Unit]
   Description=Bid Database Server
   After=network.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/bid-database
   ExecStart=/usr/bin/node server.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

3. Enable and start the service:
   ```bash
   sudo systemctl enable bid-database
   sudo systemctl start bid-database
   ```

4. Check status:
   ```bash
   sudo systemctl status bid-database
   ```

## Usage

### Protecting edits

All POST/PUT/PATCH/DELETE requests require a shared edit key. The easiest way to change it is to copy `.env.example` to `.env` and set `EDIT_KEY` to whatever passphrase you want to share with trusted collaborators:

```bash
cp .env.example .env
echo "EDIT_KEY=my-new-passphrase" >> .env
```

Restart the server so the new value is picked up. You can also set `EDIT_KEY` (or `DEFAULT_EDIT_KEY`) via any other environment management system if you prefer.

The UI prompts for the key the first time you attempt to make a change and stores it in session storage until you click the "🔓/🔒" toggle in the navigation bar to lock the session again.

### Hiding bidders from reporting views

If you need to collect bids from a subcontractor but want them excluded from bidder dashboards, activity lists, and county maps, set the `REPORTING_BIDDER_EXCLUSIONS` environment variable in your `.env` file. Provide canonical bidder names separated by commas, semicolons, pipes, or new lines:

```bash
REPORTING_BIDDER_EXCLUSIONS="XYZ Construction,ACME Concrete"
```

Excluded bidders will still appear on project-level bid tabs so you can track their submissions, but they will be omitted from cross-project reporting endpoints.

### Adding a Project

1. Click "+ Add Project" on the main page
2. Enter project name (required)
3. Optionally enter building square footage and project date
4. Click "Create Project"

### Uploading a Bid Tab

1. Open a project
2. Click "📤 Upload Bid Tab"
3. Select your Excel bid tabulation file
4. The system will automatically:
   - Extract building SF from cell D3 on "GMP Summary" sheet
   - Extract project date from cell D2 on "GMP Summary" sheet
   - Parse all bid packages from individual sheets
   - Calculate low/median/high/average bids
   - Identify which bid was selected (marked with "y")
   - Flag packages where the selected bid was not the actual low bid

### Adding Manual Packages

1. Open a project
2. Click "+ Add Package"
3. Enter package code (e.g., "12A")
4. Enter package name (e.g., "Loose Furnishings")
5. Enter estimated amount
6. The package will be marked as "Estimated" status

### Editing Packages

1. Click "Edit" on any package
2. Update package details
3. Add bidder name to convert from "Estimated" to "Bid" status
4. Save changes

### Viewing Analytics

1. Click "Dashboard" in the navigation
2. View aggregate metrics by CSI division
3. See bidder performance across all projects
4. Filter and sort data as needed

### Comparing Projects

1. Click "Compare" in the navigation
2. Select two or more projects from the list
3. Choose which metric to plot on the bar chart and which data set to use in the bid-mix pies
4. Review totals, $/SF metrics, and CSI breakdowns to benchmark projects against each other

## Bid Tab Format Requirements

The application expects Excel files with the following structure:

### GMP Summary Sheet (Optional but recommended)
- Cell D2: Project date
- Cell D3: Building square footage

### Individual Package Sheets
- Each sheet represents a bid package
- Sheet name should include package code (e.g., "03A - Concrete")
- Must have columns for:
  - Bidder/Contractor names
  - Bid amounts
  - Selection indicator ("y" or "Y" in a column to mark selected bid)

Example structure:
```
| Contractor    | Bid Amount | Use |
|---------------|------------|-----|
| ABC Concrete  | 500000     | y   |
| XYZ Concrete  | 525000     |     |
| 123 Concrete  | 510000     |     |
```

## Database

The application uses SQLite for data storage. The database file (`bid_database.sqlite`) is created automatically in the project directory.

### Database Schema

- **projects**: Project information
- **bid_events**: Tracks which Excel file added packages to a project
- **bidders**: Normalized bidder names
- **bidder_aliases**: Variations of bidder names
- **packages**: Bid packages with metrics
- **bids**: Individual bids for each package

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/:id` - Get project with packages
- `GET /api/projects/compare?ids=1,2` - Compare multiple projects with computed metrics and package data
- `POST /api/projects` - Create new project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Packages
- `POST /api/packages` - Add manual package
- `PUT /api/packages/:id` - Update package
- `DELETE /api/packages/:id` - Delete package
- `GET /api/packages/:id/bids` - Get all bids for a package

### Upload
- `POST /api/upload-bid-tab` - Upload and parse bid tab Excel file

### Analytics
- `GET /api/aggregate/divisions` - Get metrics by CSI division
- `GET /api/aggregate/bidders` - Get bidder performance

### Bidders
- `GET /api/bidders` - List all bidders with aliases, bid counts, wins, and packages
- `GET /api/bidders/:id/history` - Detailed bid history for a bidder across projects
- `POST /api/bidders/merge` - Merge duplicate bidders

## Troubleshooting

### Server won't start
- Check that Node.js is installed: `node --version`
- Make sure port 3000 is not already in use
- Check for errors in console output

### Bid tab upload fails
- Ensure the file is a valid Excel file (.xlsx or .xls)
- Check that the bid tab has the expected structure
- Look for error messages in the browser console

### Database issues
- If the database becomes corrupted, you can delete `bid_database.sqlite` and restart
- The application will create a fresh database automatically
- Note: This will delete all your data

## Future Enhancements

Potential features for future development:
- PDF report generation
- Data export (Excel, CSV)
- Advanced filtering and search
- Historical trending charts
- Budget vs. bid analysis
- Email notifications for new bids
- User authentication and permissions

## License

This is a custom application developed for internal use.

## Support

For issues or questions, consult the source code comments or modify as needed for your specific requirements.
