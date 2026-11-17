// priority: 0
// Apprivoisement maximal automatique (dragons FAUNA : Book of Dragons et Schibz Burk).
//
//   /dragonmax on   : tant que c'est activé, chaque dragon à moins de 32 blocs devient à toi, affection au maximum
//   /dragonmax off  : arrête, et annule ce que le mode a fait : les dragons qu'il t'avait donnés redeviennent sauvages
//                     et neutres (affection d'avant rétablie). Ceux qui étaient déjà à toi gardent l'affection maximale
//                     (FAUNA ne permet pas de baisser le lien sans effacer toute leur mémoire de toi).
//
// Réservé aux opérateurs (permission 2). Le réglage est gardé par joueur, même après une déconnexion.
// Les dragons touchés sont marqués (données « dragonmax ») pour pouvoir tout annuler proprement.

const FaunaBase = Java.loadClass('net.magister.liberanimalium.chassis.FaunaBase')
const $CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')

const RAYON = 32          // blocs autour du joueur
const LIEN_MAX = 1000     // plafond du lien d'affection dans FAUNA (SocialBookTuning.BOND_MAX)
const CLE = 'dragonmax'   // clé des données sur le joueur et sur les dragons

function dragonsAutour(player, rayon) {
  return player.level.getEntitiesOfClass(FaunaBase, player.boundingBox.inflate(rayon))
}

function appliquer(player, dragon) {
  const uuid = player.uuid
  const data = dragon.persistentData
  // On ne note l'état d'avant qu'au premier passage, pour pouvoir le rétablir.
  if (!data.contains(CLE)) {
    const avant = new $CompoundTag()
    avant.putString('joueur', uuid.toString())
    avant.putBoolean('etaitAMoi', dragon.isTame() && uuid.equals(dragon.ownerUUID))
    avant.putInt('lien', dragon.getBond(uuid))
    data.put(CLE, avant)
  }
  if (!(dragon.isTame() && uuid.equals(dragon.ownerUUID))) {
    dragon.adopt(uuid) // pour les dragons de BoD, valide aussi le rituel d'apprivoisement
  }
  if (dragon.getBond(uuid) < LIEN_MAX) {
    dragon.setBond(uuid, LIEN_MAX)
  }
}

function annuler(player, dragon) {
  const data = dragon.persistentData
  if (!data.contains(CLE)) return false
  const avant = data.getCompound(CLE)
  if (avant.getString('joueur') !== player.uuid.toString()) return false
  if (!avant.getBoolean('etaitAMoi')) {
    // FAUNA ne sait que monter le lien : on efface la mémoire du dragon envers le joueur, puis on remet le lien d'avant.
    const social = dragon.faunaMind().knowledge().social()
    social.forget(player.uuid)
    if (avant.getInt('lien') > 0) social.seedBond(player.uuid, avant.getInt('lien'))
    dragon.setTame(false)
    dragon.setOwnerUUID(null)
    if (dragon.setTamingRitualCompleted) dragon.setTamingRitualCompleted(false) // dragons de BoD
  }
  data.remove(CLE)
  return true
}

ServerEvents.commandRegistry(event => {
  const { commands: Commands } = event
  event.register(Commands.literal('dragonmax')
    .requires(src => src.hasPermission(2))
    .then(Commands.literal('on').executes(ctx => {
      const player = ctx.source.playerOrException
      player.persistentData.putBoolean(CLE, true)
      dragonsAutour(player, RAYON).forEach(d => appliquer(player, d))
      player.tell(Text.green('Apprivoisement maximal activé : les dragons autour de toi sont à toi, affection au maximum.'))
      return 1
    }))
    .then(Commands.literal('off').executes(ctx => {
      const player = ctx.source.playerOrException
      player.persistentData.putBoolean(CLE, false)
      let n = 0
      // Les dragons chargés du monde (dimension du joueur) ; ceux d'autres zones seront annulés quand le joueur
      // repassera près d'eux (voir le tick ci-dessous).
      player.level.getEntitiesOfClass(FaunaBase, player.boundingBox.inflate(4096)).forEach(d => { if (annuler(player, d)) n++ })
      player.persistentData.putBoolean(CLE + '_annuler', true)
      player.tell(Text.yellow(`Apprivoisement maximal désactivé : ${n} dragon(s) rétabli(s) comme avant.`))
      return 1
    })))
})

// Une fois par seconde : applique (mode activé) ou finit d'annuler (après « off ») autour du joueur.
PlayerEvents.tick(event => {
  const player = event.player
  if (player.level.isClientSide() || player.tickCount % 20 !== 0) return
  const data = player.persistentData
  if (data.getBoolean(CLE)) {
    dragonsAutour(player, RAYON).forEach(d => appliquer(player, d))
  } else if (data.getBoolean(CLE + '_annuler')) {
    dragonsAutour(player, RAYON).forEach(d => annuler(player, d))
  }
})
