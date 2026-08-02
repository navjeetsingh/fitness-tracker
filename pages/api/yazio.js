// pages/api/yazio.js
// Yazio has no public API — accepts manually pasted nutrition data
// POST: { date, protein, calories, carbs, fat, meals[] }
// GET: returns stored data from env-based simple store

const PROTEIN_TARGET = 150 // grams/day for marathon training

export default function handler(req, res) {
  if (req.method === 'POST') {
    // Client sends today's nutrition data (copy from Yazio app)
    const { protein, calories, carbs, fat, date } = req.body
    const gap = PROTEIN_TARGET - (protein || 0)
    res.json({
      received: true,
      date,
      protein,
      calories,
      carbs,
      fat,
      proteinTarget: PROTEIN_TARGET,
      proteinGap: gap > 0 ? gap : 0,
      proteinStatus: gap <= 0 ? 'on_target' : gap < 50 ? 'close' : 'deficit',
    })
  } else {
    res.json({
      message: 'Yazio has no public API. Use the Update Nutrition button on the dashboard to enter today\'s data from the Yazio app.',
      proteinTarget: PROTEIN_TARGET,
    })
  }
}
