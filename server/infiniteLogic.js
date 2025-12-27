function generateNextRow(previousRow, width, difficultyRatio) {
  const newRow = [];
  
  // 1. Placement des mines sur la nouvelle ligne
  for(let x = 0; x < width; x++) {
     const isMine = Math.random() < difficultyRatio; // ex: 0.15
     newRow.push({ 
         x, 
         // y sera défini par l'appelant
         isMine, 
         isOpen: false,
         flag: 0,
         neighborCount: 0,
         quantumRange: null 
     });
  }

  // 2. Mise à jour de "La Couture" (The Seam)
  // On doit recalculer les chiffres de la ligne PRÉCÉDENTE car la nouvelle ligne l'influence
  if (previousRow) {
    updateSeamLine(previousRow, newRow);
  }
  
  // 3. Calculer les chiffres de la NOUVELLE ligne (basé sur la précédente uniquement pour l'instant)
  // Note: Les chiffres seront mis à jour à nouveau quand la ligne suivante sera générée
  calculatePartialNumbers(newRow, previousRow);

  return newRow;
}

function updateSeamLine(oldRow, newRow) {
   const width = oldRow.length;
   // Pour chaque cellule de la vieille ligne, on regarde les 3 voisins en dessous (dans newRow)
   for(let x = 0; x < width; x++) {
       const cell = oldRow[x];
       if (cell.isMine) continue;

       // Voisins du bas: (x-1, y+1), (x, y+1), (x+1, y+1)
       // Ici newRow correspond à y+1
       for(let dx = -1; dx <= 1; dx++) {
           const nx = x + dx;
           if (nx >= 0 && nx < width) {
               if (newRow[nx].isMine) {
                   cell.neighborCount++;
               }
           }
       }
   }
}

function calculatePartialNumbers(newRow, previousRow) {
    const width = newRow.length;
    for(let x = 0; x < width; x++) {
        const cell = newRow[x];
        if (cell.isMine) continue;

        let count = 0;

        // Vérifier les voisins sur la même ligne (gauche, droite)
        if (x > 0 && newRow[x-1].isMine) count++;
        if (x < width - 1 && newRow[x+1].isMine) count++;

        // Vérifier les voisins de la ligne précédente (haut-gauche, haut, haut-droite)
        if (previousRow) {
            for(let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < width) {
                    if (previousRow[nx].isMine) {
                        count++;
                    }
                }
            }
        }
        
        cell.neighborCount = count;
    }
}

module.exports = { generateNextRow };
