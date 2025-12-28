class MinesweeperGame {
  constructor(rows, cols, minesCount, mode = 'classic', hp = 3, difficulty = 'medium') {
    this.rows = rows;
    this.cols = cols;
    this.minesCount = minesCount;
    this.mode = mode; // 'classic' ou 'hardcore'
    this.hp = hp; 
    this.difficulty = difficulty;
    this.grid = []; // Initialement vide
    this.isGenerated = false;
    
    // Scanner Logic
    // Easy/Medium: 2 scans. Hard/Hardcore: 1 scan.
    this.scansAvailable = (difficulty === 'easy' || difficulty === 'medium') ? 2 : 1;
  }

  // Initialise une grille vide
  initializeEmptyGrid() {
    this.grid = Array(this.rows).fill().map((_, y) => 
      Array(this.cols).fill().map((_, x) => ({
        x, y,
        isMine: false,
        isOpen: false,
        flag: 0, // 0: none, 1: flag, 2: question 
        scanned: null, // null | 'mine' | 'safe'
        neighborCount: 0,
        lyingNumbers: null // Pour la difficulté "hardcore"
      }))
    );
  }



  scanCell(x, y) {
      if (!this.isValid(x, y)) return null;
      if (this.scansAvailable <= 0) return null;
      
      const cell = this.grid[y][x];
      
      // Cannot scan if already open or already scanned
      if (cell.isOpen || cell.scanned) return null;

      // Perform scan
      cell.scanned = cell.isMine ? 'mine' : 'safe';
      this.scansAvailable--;

      return { 
          cell, 
          scansAvailable: this.scansAvailable 
      };
  }


  // Vérifie si le joueur a gagné (toutes les cases non-minées sont ouvertes)
  checkWin() {
      for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
              const cell = this.grid[y][x];
              if (!cell.isMine && !cell.isOpen) {
                  return false;
              }
          }
      }
      return true;
  }

  // Prépare le niveau suivant en gardant la dernière ligne comme première
  initializeNextLevel(previousLastRow) {
      // Reset Scanner for new level (Always 1 for infinite mode levels as per request)
      this.scansAvailable = 1;

      // 1. Reset grid but keep size
      this.grid = Array(this.rows).fill().map((_, y) => 
        Array(this.cols).fill().map((_, x) => ({
          x, y,
          isMine: false,
          isOpen: false,
          flag: 0, 
          scanned: null,
          neighborCount: 0,
          lyingNumbers: null
        }))
      );

      // 2. Import previous row as TOP row (y=0)
      for(let x = 0; x < this.cols; x++) {
          const prevCell = previousLastRow[x];
          this.grid[0][x].isMine = prevCell.isMine;
          this.grid[0][x].isOpen = prevCell.isOpen; 
          this.grid[0][x].flag = prevCell.flag;
          // IMPORTANT: Preserve the numerical "truth" logic from previous game
          // We store the target number so generateSeam can try to match it.
          this.grid[0][x].targetNumber = prevCell.neighborCount;
          this.grid[0][x].neighborCount = prevCell.neighborCount; // Visually keep it
      }

      this.isGenerated = false; 
      
      // 3. Generate the "Seam" (Row 1) to satisfy Row 0's numbers
      this.generateSeam();
      
      // 4. Generate the rest of the board (Row 2+)
      // Note: We pass startRow=2 to generateMines
      this.generateMines(0, 0, 2); 
  }

  // Generates mines in Row 1 to satisfy Row 0's target numbers
  generateSeam() {
      // We only touch Row 1. Row 0 is fixed.
      for (let x = 0; x < this.cols; x++) {
          const cell0 = this.grid[0][x];
          
          if (cell0.isMine) continue;
          if (!cell0.targetNumber) continue;

          // Count existing mines around (x,0) in Row 0 ONLY (Left/Right)
          // Row 1 is currently empty (or partially filled by previous iteration of this loop)
          let currentCount = 0;
          const neighbors = [
              {dx: -1, dy: 0}, {dx: 1, dy: 0}, // Row 0
              {dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1} // Row 1
          ];

          for (const {dx, dy} of neighbors) {
              const nx = x + dx, ny = dy; // dy is 0 or 1
              if (this.isValid(nx, ny) && this.grid[ny][nx].isMine) {
                  currentCount++;
              }
          }

          let deficit = cell0.targetNumber - currentCount;
          
          if (deficit > 0) {
              // We need to place 'deficit' mines in available Row 1 spots
              const candidates = [];
              // Only consider Row 1 neighbors that are NOT yet mines
              [{dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1}].forEach(({dx, dy}) => {
                  const nx = x + dx;
                  if (this.isValid(nx, dy) && !this.grid[dy][nx].isMine) {
                      candidates.push(this.grid[dy][nx]);
                  }
              });

              // Shuffle candidates for organic randomness
              for (let i = candidates.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
              }

              // Fill needed mines
              for (let i = 0; i < deficit && i < candidates.length; i++) {
                  candidates[i].isMine = true;
                  this.minesCount++; // Track total mines
              }
          } 
          // If deficit < 0, it means we already have too many mines (placed by left neighbor constraints).
          // We can't remove them easily without breaking left neighbor. Value will just be higher.
      }
  }

  // Génère les mines APRÈS le premier clic pour garantir la sécurité 
  generateMines(safeX, safeY, startRowOverride = null) {
    let minesPlaced = 0;
    
    // Count mines already existing (e.g. from imported row or seam)
    for(let y=0; y<this.rows; y++) {
        for(let x=0; x<this.cols; x++) {
            if(this.grid[y][x].isMine) minesPlaced++;
        }
    }

    // Determine start row for generation
    // If override provided (infinite mode), use it.
    // Else, protect imported row 0 if next level logic detected
    let startRow = 0;
    if (startRowOverride !== null) {
        startRow = startRowOverride;
    } else {
         startRow = (this.grid[0].some(c => c.isOpen || c.isMine)) ? 1 : 0;
    }

    // Safety check: if startRow >= rows, just stop
    if (startRow >= this.rows) return;

    while (minesPlaced < this.minesCount) {
      const x = Math.floor(Math.random() * this.cols);
      // Ensure y is in [startRow, rows-1]
      const y = Math.floor(Math.random() * (this.rows - startRow)) + startRow; 

      // Vérifie si la case est déjà une mine OU si c'est la zone sûre (le clic + voisins)
      if (!this.grid[y][x].isMine && !this.isSafeZone(x, y, safeX, safeY)) {
        this.grid[y][x].isMine = true;
        minesPlaced++;
      }
    }
    
    // First pass to identify zero areas
    this.calculateNumbers();

    // Second pass: Roughen (fill in) zero areas based on difficulty
    this.roughenShapes(safeX, safeY);

    // Re-calculate numbers after adding new mines
    this.calculateNumbers();
    
    // Application de la difficulté "Hardcore" (Lying Numbers)
    if (this.difficulty === 'hardcore') {
        this.applyLyingNumbers();
    }
    
    this.isGenerated = true;
  }

  // Zone de sécurité autour du premier clic (3x3)
  isSafeZone(x, y, safeX, safeY) {
    return Math.abs(x - safeX) <= 1 && Math.abs(y - safeY) <= 1;
  }

  // Second pass to reduce continuous areas of zeros and roughen edges
  roughenShapes(safeX, safeY) {
      let probability = 0.3; // Probability for "internal" holes
      let edgeProbability = 0.3; // Probability to erode "edges" (jagged look)
      
      if (this.difficulty === 'easy') {
          probability = 0.2; 
          edgeProbability = 0.2; // Aggressive erosion on easy
      }

      for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
              const cell = this.grid[y][x];
              
              // Only target zero-value cells (empty spaces) that are not mines
              if (!cell.isMine && cell.neighborCount === 0 && !this.isSafeZone(x, y, safeX, safeY)) {
                  
                  // Check if this cell is on the "edge" of a zero-zone
                  // An edge cell has at least one neighbor that is NOT a zero (i.e., it has a number)
                  let isEdge = false;
                  const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
                  for (const [dx, dy] of directions) {
                      const nx = x + dx, ny = y + dy;
                      if (this.isValid(nx, ny)) {
                          const neighbor = this.grid[ny][nx];
                          // If neighbor exists, is not a mine, and has a number > 0
                          if (!neighbor.isMine && neighbor.neighborCount > 0) {
                              isEdge = true;
                              break;
                          }
                      }
                  }

                  // Use higher probability for edges to break straight lines
                  const p = isEdge ? edgeProbability : probability;

                  if (Math.random() < p) {
                      cell.isMine = true;
                      this.minesCount++;
                  }
              }
          }
      }
  }

  // Calcul des chiffres voisins
  calculateNumbers() {
    const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
    
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.grid[y][x].isMine) continue;

        let count = 0;
        directions.forEach(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          if (this.isValid(nx, ny) && this.grid[ny][nx].isMine) {
            count++;
          }
        });
        this.grid[y][x].neighborCount = count;
      }
    }
  }



  // Logique "Hardcore Difficulty": Lying Numbers
  applyLyingNumbers() {
      for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
              const cell = this.grid[y][x];
              
              // Appliquer seulement sur les cases sûres avec des voisins (>0)
              // ~12.5% de chance d'avoir un "nombre menteur" (Reduced by 50% from 0.25)
              if (!cell.isMine && cell.neighborCount > 0 && Math.random() < 0.125) {
                  const trueNum = cell.neighborCount;
                  let fakeNum;
                  
                  // Générer un faux chiffre proche (+/- 1 ou 2)
                  do {
                    const offset = (Math.floor(Math.random() * 3) + 1) * (Math.random() < 0.5 ? 1 : -1);
                    fakeNum = trueNum + offset;
                  } while (fakeNum < 1 || fakeNum > 8 || fakeNum === trueNum);

                  // Mélanger l'ordre [vrai, faux] ou [faux, vrai]
                  cell.lyingNumbers = Math.random() < 0.5 ? [trueNum, fakeNum] : [fakeNum, trueNum];
              }
          }
      }
  }

  processClick(x, y) {
      if (!this.isValid(x, y)) return { hitMine: false, changes: [] };
      const cell = this.grid[y][x];
      
      if (cell.isOpen || cell.flag === 1) return { hitMine: false, changes: [] }; // Déjà ouvert ou drapeau

      if (!this.isGenerated) {
          this.generateMines(x, y);
      }

      if (cell.isMine) {
          return { hitMine: true, changes: [] };
      }

      // Révélation récursive (Flood Fill)
      const changes = [];
      this.revealRecursive(x, y, changes);
      return { hitMine: false, changes };
  }

  revealRecursive(x, y, changes) {
      if (!this.isValid(x, y)) return;
      const cell = this.grid[y][x];
      
      if (cell.isOpen || cell.flag === 1) return;
      
      cell.isOpen = true;
      changes.push(cell);

      if (cell.neighborCount === 0 && !cell.isMine) {
          const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
          for (const [dx, dy] of directions) {
              this.revealRecursive(x + dx, y + dy, changes);
          }
      }
  }

  toggleFlag(x, y) {
      if (!this.isValid(x, y)) return null;
      const cell = this.grid[y][x];
      
      if (cell.isOpen) return null; // Cannot flag open cell

      // Cycle: 0 -> 1 -> 2 -> 0
      cell.flag = (cell.flag + 1) % 3;
      
      return cell;
  }

  isValid(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }
}

module.exports = MinesweeperGame;
