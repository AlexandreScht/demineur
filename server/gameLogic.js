class MinesweeperGame {
  constructor(rows, cols, minesCount, mode = 'classic', hp = 3, difficulty = 'medium', customScans = 0, allowLying = false, lyingChance = 12.5) {
    this.rows = rows;
    this.cols = cols;
    this.minesCount = minesCount;
    this.initialMinesCount = minesCount;
    this.mode = mode; // 'classic' ou 'hardcore'
    this.hp = hp; 
    this.difficulty = difficulty;
    this.customScans = customScans;
    this.allowLying = allowLying;
    this.lyingChance = lyingChance;
    this.grid = []; // Initialement vide
    this.isGenerated = false;
    
    // Scanner Logic
    if (difficulty === 'custom') this.scansAvailable = customScans;
    else if (difficulty === 'easy') this.scansAvailable = 1;
    else if (difficulty === 'medium') this.scansAvailable = 2;
    else this.scansAvailable = 3;
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

  // Vérifie si le joueur a gagné
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

  // Prépare le niveau suivant
  initializeNextLevel(previousLastRow) {
      if (this.difficulty === 'custom') this.scansAvailable = this.customScans;
      else if (this.difficulty === 'easy') this.scansAvailable = 1;
      else if (this.difficulty === 'medium') this.scansAvailable = 2;
      // Reset Mines Count - Will be calculated based on Initial + Row 0
      
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
      let minesInRow0 = 0;
      for(let x = 0; x < this.cols; x++) {
          const prevCell = previousLastRow[x];
          this.grid[0][x].isMine = prevCell.isMine;
          
          if (prevCell.isMine) {
              this.grid[0][x].isOpen = true;
              this.grid[0][x].flag = 0; // Remove flag to show the bomb icon
              minesInRow0++;
          } else {
              this.grid[0][x].isOpen = prevCell.isOpen; 
              this.grid[0][x].flag = prevCell.flag;
          }

          this.grid[0][x].targetNumber = prevCell.neighborCount;
          this.grid[0][x].neighborCount = prevCell.neighborCount; 
      }
      
      // Update Target Count: Initial Budget + Carried Over Mines from Row 0
      this.minesCount = this.initialMinesCount + minesInRow0;

      this.isGenerated = false; 
      
      // 3. Generate the "Seam" (Row 1)
      const seamForbidden = this.generateSeam();
      
      // 4. Generate the rest of the board (Row 1+, respecting seam constraints)
      this.generateMines(0, 0, 1, seamForbidden); 
  }

  generateSeam() {
      const constrained = new Set();

      for (let x = 0; x < this.cols; x++) {
          const cell0 = this.grid[0][x];
          
          if (cell0.isMine) continue;
          if (!cell0.targetNumber) continue;

          // If targetNumber > 0, we MUST constrain all Row 1 neighbors to satisfy the exact count
          [{dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1}].forEach(({dx, dy}) => {
              const nx = x + dx;
              if (this.isValid(nx, dy)) {
                  constrained.add(`${nx},${dy}`);
              }
          });

          let currentCount = 0;
          const neighbors = [
              {dx: -1, dy: 0}, {dx: 1, dy: 0}, 
              {dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1} 
          ];

          for (const {dx, dy} of neighbors) {
              const nx = x + dx, ny = dy; 
              if (this.isValid(nx, ny) && this.grid[ny][nx].isMine) {
                  currentCount++;
              }
          }

          let deficit = cell0.targetNumber - currentCount;
          
          if (deficit > 0) {
              const candidates = [];
              [{dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1}].forEach(({dx, dy}) => {
                  const nx = x + dx;
                  if (this.isValid(nx, dy) && !this.grid[dy][nx].isMine) {
                      candidates.push(this.grid[dy][nx]);
                  }
              });

              for (let i = candidates.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
              }

              for (let i = 0; i < deficit && i < candidates.length; i++) {
                  candidates[i].isMine = true;
                  // Mine count is NOT incremented here; these mines consume the generation budget.
              }
          } 
      }
      return constrained;
  }

  // --- NOUVELLE FONCTION CLÉ ---
  // Génère une zone complexe et irrégulière qui sera garantie sans mines
  generateOrganicSafeZone(startX, startY) {
      const zeroCells = new Set();
      const add = (x, y) => {
          if (this.isValid(x, y)) zeroCells.add(`${x},${y}`);
      };

      // 1. Base : Une croix plutôt qu'un carré pour casser la forme dès le début
      add(startX, startY);
      add(startX + 1, startY);
      add(startX - 1, startY);
      add(startX, startY + 1);
      add(startX, startY - 1);

      // 2. Extensions irrégulières ("Tentacules")
      // On choisit aléatoirement 2 à 3 directions pour étendre la zone
      // Cela garantit que au moins 2 côtés ne sont pas plats.
      const directions = [[1,0], [-1,0], [0,1], [0,-1]].sort(() => Math.random() - 0.5);
      const branches = Math.floor(Math.random() * 2) + 2; // 2 ou 3 branches

      for (let i = 0; i < branches; i++) {
          let [dx, dy] = directions[i];
          // Longueur aléatoire pour chaque branche (crée l'asymétrie)
          let length = Math.floor(Math.random() * 3) + 2; 
          
          let cx = startX, cy = startY;
          for (let step = 0; step < length; step++) {
              cx += dx; cy += dy;
              add(cx, cy);
              
              // Ajout de "bruit" latéral pour faire des trous/irrégularités sur les côtés
              if (Math.random() > 0.4) {
                  // Ajoute une case perpendiculaire
                  if (this.isValid(cx + dy, cy + dx)) add(cx + dy, cy + dx);
              }
          }
      }

      // 3. Calcul de la zone interdite totale
      // Pour qu'une case soit un "0", elle ET ses voisins doivent être vides.
      // Donc Forbidden = (ZeroCells) + (Voisins de ZeroCells)
      const forbiddenMines = new Set(zeroCells);
      
      zeroCells.forEach(key => {
          const [kx, ky] = key.split(',').map(Number);
          // On ajoute tous les voisins de chaque case "0" à la liste interdite
          for(let dy = -1; dy <= 1; dy++) {
              for(let dx = -1; dx <= 1; dx++) {
                  const nx = kx + dx, ny = ky + dy;
                  if (this.isValid(nx, ny)) {
                      forbiddenMines.add(`${nx},${ny}`);
                  }
              }
          }
      });

      return forbiddenMines;
  }

  // Génère les mines APRÈS le premier clic
  generateMines(safeX, safeY, startRowOverride = null, extraForbidden = null) {
    let minesPlaced = 0;
    
    for(let y=0; y<this.rows; y++) {
        for(let x=0; x<this.cols; x++) {
            if(this.grid[y][x].isMine) minesPlaced++;
        }
    }

    let startRow = 0;
    if (startRowOverride !== null) {
        startRow = startRowOverride;
    } else {
         startRow = (this.grid[0].some(c => c.isOpen || c.isMine)) ? 1 : 0;
    }

    if (startRow >= this.rows) return;

    // --- CHANGEMENT ICI ---
    // Au lieu d'une simple formule isSafeZone, on génère un masque complexe
    // Si startRowOverride est actif (mode infini), on utilise une protection simple (3x3)
    // Sinon (début de partie), on utilise la forme organique complexe.
    let forbiddenSet;
    if (startRowOverride !== null) {
        forbiddenSet = new Set();
        // If we have extraForbidden constraints (Seam constraints), use them
        if (extraForbidden) {
             extraForbidden.forEach(k => forbiddenSet.add(k));
        }
        // Minimal safety for Infinite Mode if no extra constraints provided? 
        // Actually, if startRowOverride is used, usually we rely on that. 
        // The original code added a 3x3 safety zone here around SAFE_X/SAFE_Y. 
        // But in Infinite Mode scroll, SAFE_X/SAFE_Y are meaningless (usually 0,0).
        // So we strictly trust extraForbidden if present, or create minimal if empty?
        // Let's keep the user's implicit logic: if extraForbidden is provided, it's the constraint.
    } else {
        forbiddenSet = this.generateOrganicSafeZone(safeX, safeY);
    }

    while (minesPlaced < this.minesCount) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * (this.rows - startRow)) + startRow; 
      
      // ... logic continues ...
      const key = `${x},${y}`;

      // Vérifie si la case est interdite (dans notre forme complexe)
      if (!this.grid[y][x].isMine && !forbiddenSet.has(key)) {
        this.grid[y][x].isMine = true;
        minesPlaced++;
      }
    }
    
    this.calculateNumbers();

    // On passe forbiddenSet à roughenShapes pour qu'il ne détruise pas notre zone safe
    this.roughenShapes(forbiddenSet);

    this.calculateNumbers();
    
    if (this.difficulty === 'hardcore' || (this.difficulty === 'custom' && this.allowLying)) {
        this.applyLyingNumbers();
    }
    
    this.isGenerated = true;
  }

  // Second pass: Roughen shapes, but RESPECT the guaranteed safe zone
  roughenShapes(forbiddenSet) {
      let probability = 0.3; 
      let edgeProbability = 0.3; 
      
      if (this.difficulty === 'easy') {
          probability = 0.2; 
          edgeProbability = 0.2; 
      }

      for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
              const cell = this.grid[y][x];
              const key = `${x},${y}`;
              
              // NE PAS TOUCHER SI C'EST DANS LA ZONE DE DÉPART (forbiddenSet)
              if (forbiddenSet.has(key)) continue;

              if (!cell.isMine && cell.neighborCount === 0) {
                  
                  let isEdge = false;
                  const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
                  for (const [dx, dy] of directions) {
                      const nx = x + dx, ny = y + dy;
                      if (this.isValid(nx, ny)) {
                          const neighbor = this.grid[ny][nx];
                          if (!neighbor.isMine && neighbor.neighborCount > 0) {
                              isEdge = true;
                              break;
                          }
                      }
                  }

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
  // Logique "Hardcore Difficulty": Lying Numbers
  applyLyingNumbers() {
      const probability = this.difficulty === 'hardcore' ? 0.125 : (this.lyingChance / 100);

      for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
              const cell = this.grid[y][x];
              
              if (!cell.isMine && cell.neighborCount > 0 && Math.random() < probability) {
                  const trueNum = cell.neighborCount;
                  let fakeNum;
                  
                  do {
                    const offset = (Math.floor(Math.random() * 3) + 1) * (Math.random() < 0.5 ? 1 : -1);
                    fakeNum = trueNum + offset;
                  } while (fakeNum < 1 || fakeNum > 8 || fakeNum === trueNum);

                  cell.lyingNumbers = Math.random() < 0.5 ? [trueNum, fakeNum] : [fakeNum, trueNum];
              }
          }
      }
  }

  processClick(x, y) {
      if (!this.isValid(x, y)) return { hitMine: false, changes: [] };
      const cell = this.grid[y][x];
      
      if (cell.isOpen || cell.flag === 1) return { hitMine: false, changes: [] }; 

      if (!this.isGenerated) {
          this.generateMines(x, y);
      }

      if (cell.isMine) {
          return { hitMine: true, changes: [] };
      }

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
      
      if (cell.isOpen) return null; 

      cell.flag = (cell.flag + 1) % 3;
      
      return cell;
  }

  isValid(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }
}

module.exports = MinesweeperGame;