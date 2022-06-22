import { BigNumber } from "ethers";

const { expect } = require("chai");
const { ethers } = require('hardhat')

describe("WeSendit", function () {
  let token: any;;
  let owner: any;
  let tge: any;
  let alice: any;
  let bob: any;
  let charlie: any;
  let fees: any;
  let addrs: any;
  let mockStakingPool: any;

  const TGE_AMOUNT = ethers.utils.parseEther('37500000');
  const INITIAL_SUPPLY = ethers.utils.parseEther('1462500000');

  const SEED_AMOUNT = ethers.utils.parseEther('75000000')
  const PRIVATE_AMOUNT = ethers.utils.parseEther('120000000')

  beforeEach(async function () {
    const WeSenditToken = await ethers.getContractFactory("WeSenditToken");
    [owner, alice, bob, charlie, tge, fees, ...addrs] = await ethers.getSigners();

    token = await WeSenditToken.deploy(tge.address);

    await token.setActivityPoolAddress(fees.address)
    await token.setReferralPoolAddress(fees.address)
    await token.setStakingPoolAddress(fees.address)
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should assign supply to TGE wallet and contract", async function () {
      const tgeBalance = await token.balanceOf(tge.address);
      expect(tgeBalance).to.equal(TGE_AMOUNT);

      const contractBalance = await token.balanceOf(token.address);
      expect(contractBalance).to.equal(INITIAL_SUPPLY);
    });
  });

  describe('Distribution', function () {
    it('should correctly distribute seed and private sale tokens', async function () {
      const seedWallet = addrs[0]
      const privateWallet = addrs[1]

      await token.distributeSaleToken(seedWallet.address, privateWallet.address)

      const seedBalance = await token.balanceOf(seedWallet.address)
      expect(seedBalance).to.equal(SEED_AMOUNT);

      const privateBalance = await token.balanceOf(privateWallet.address)
      expect(privateBalance).to.equal(PRIVATE_AMOUNT);
    })

    it('should correctly distribute rest of tokens', async function () {
      const wallets = addrs.slice(0, 10)
      const expectedBalances = [
        180000000,
        75000000,
        75000000,
        225000000,
        180000000,
        150000000,
        120000000,
        120000000,
        45000000,
        45000000
      ]

      await token.distributeToken(...wallets.map((wallet: any) => wallet.address))

      for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i]
        const expectedBalance = ethers.utils.parseEther(expectedBalances[i].toString())

        const actualBalance = await token.balanceOf(wallet.address)
        expect(actualBalance).to.equal(expectedBalance)
      }
    })

    it('should correctly distribute reserve tokens', async function () {
      const wallets = addrs.slice(0, 1)
      const expectedBalances = [
        52500000
      ]

      await token.distributeReserveToken(...wallets.map((wallet: any) => wallet.address))

      for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i]
        const expectedBalance = ethers.utils.parseEther(expectedBalances[i].toString())

        const actualBalance = await token.balanceOf(wallet.address)
        expect(actualBalance).to.equal(expectedBalance)
      }
    })
  })

  describe("Fees", function () {
    beforeEach(async function () {
      await token.distributeSaleToken(owner.address, owner.address)
      await token.transfer(
        alice.address,
        ethers.utils.parseEther('10000')
      )
    })

    it('should charge fee on transfer', async function () {
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('0.97')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0.03')
      );
    })

    it('should charge fees on transferFrom', async function () {
      await token.connect(alice).approve(
        bob.address,
        ethers.utils.parseEther('1')
      )

      const allowanceBefore = await token.allowance(
        alice.address,
        bob.address
      )
      expect(allowanceBefore).to.equal(
        ethers.utils.parseEther('1')
      );

      await token.connect(bob).transferFrom(
        alice.address,
        charlie.address,
        ethers.utils.parseEther('1')
      );

      const balance = await token.balanceOf(charlie.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('0.97')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0.03')
      );

      const allowanceAfter = await token.allowance(
        alice.address,
        bob.address
      )
      expect(allowanceAfter).to.equal(
        ethers.utils.parseEther('0')
      );
    })

    it('should not charge fee if sender is owner', async function () {
      await token.transfer(
        bob.address,
        ethers.utils.parseEther('1')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('1')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0')
      );
    })

    it('should not charge fee if addresses are not set', async function () {
      await token.setActivityPoolAddress(ethers.constants.AddressZero)
      await token.setReferralPoolAddress(ethers.constants.AddressZero)
      await token.setStakingPoolAddress(ethers.constants.AddressZero)
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('1')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0')
      );
    })

    it('should not charge fee if they`re disabled', async function () {
      await token.setFeesEnabled(false)
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('1')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0')
      );
    })
  })

  describe("Transactions", function () {
    beforeEach(async function () {
      await token.distributeSaleToken(owner.address, owner.address)
      await token.transfer(
        alice.address,
        ethers.utils.parseEther('10000')
      )
    })

    it('should transfer tokens and charge fee (0.01)', async function () {
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('0.01')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('0.0097')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0.0003')
      );
    })

    it('should transfer tokens and charge fee (100)', async function () {
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('100')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('97')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('3')
      );
    })

    it('should transfer tokens and charge fee (1000)', async function () {
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1000')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('970')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('30')
      );
    })

    it('should transfer tokens and charge fee (10000)', async function () {
      await token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('10000')
      );

      const balance = await token.balanceOf(bob.address);
      expect(balance).to.equal(
        ethers.utils.parseEther('9700')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('300')
      );
    })

    it('should transfer tokens to Pancake Router and charge no fee', async function () {
      await token.connect(alice).transfer(
        '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        ethers.utils.parseEther('10000')
      );

      const balance = await token.balanceOf('0x10ED43C718714eb63d5aA57B78B54704E256024E');
      expect(balance).to.equal(
        ethers.utils.parseEther('10000')
      );

      const feesBalance = await token.balanceOf(fees.address)
      expect(feesBalance).to.equal(
        ethers.utils.parseEther('0')
      );
    })

    it("Should fail if sender doesn`t have enough tokens", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);
      await expect(
        token.connect(bob).transfer(owner.address, 1)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      // Owner balance shouldn't have changed.
      expect(await token.balanceOf(owner.address)).to.equal(
        initialOwnerBalance
      );
    });

    it("Should update balances after transfers", async function () {
      const initialSenderBalance = await token.balanceOf(alice.address);

      await token.connect(alice).transfer(bob.address, ethers.utils.parseEther('100'));
      await token.connect(alice).transfer(charlie.address, ethers.utils.parseEther('50'));

      const finalSenderBalance = await token.balanceOf(alice.address);
      expect(finalSenderBalance).to.equal(initialSenderBalance.sub(ethers.utils.parseEther('150')));

      const addr1Balance = await token.balanceOf(bob.address);
      expect(addr1Balance).to.equal(ethers.utils.parseEther('97'));

      const addr2Balance = await token.balanceOf(charlie.address);
      expect(addr2Balance).to.equal(ethers.utils.parseEther('48.5'));
    });
  });

  describe('minTxAmount', function () {
    beforeEach(async function () {
      await token.distributeSaleToken(owner.address, owner.address)
      await token.setFeesEnabled(false)

      await token.setMinTxAmount(ethers.utils.parseEther('0.1'))
    })

    it("Should transfer if minTxAmount is less than transfer amount", async function () {
      await token.transfer(
        alice.address,
        ethers.utils.parseEther('0.111')
      )

      expect(await token.balanceOf(alice.address)).to.equal(
        ethers.utils.parseEther('0.111')
      );
    });

    it("Should fail if minTxAmount is greater than transfer amount", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);
      await expect(token.transfer(
        alice.address,
        ethers.utils.parseEther('0.0999')
      )).to.be.revertedWith("WeSendit: amount is less than minTxAmount");

      expect(await token.balanceOf(owner.address)).to.equal(
        initialOwnerBalance
      );
    });
  })

  describe('Withdraw', function () {
    it('Should withdraw all tokens if caller is owner', async function () {
      const tokenBalance = await token.balanceOf(token.address)

      await token.emergencyWithdraw(alice.address)

      const aliceBalance = await token.balanceOf(alice.address)
      expect(aliceBalance).to.equal(tokenBalance)
    })

    it('Should fail if caller isn`t owner', async function () {
      await expect(
        token.connect(alice).emergencyWithdraw(alice.address)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('Pausing', function () {
    beforeEach(async function () {
      await token.distributeSaleToken(owner.address, owner.address)
    })

    it('Should pause all transactions except from owner -> x', async function () {
      await token.setFeesEnabled(false)
      await token.setPauseEnabled(true)

      await token.transfer(
        alice.address,
        ethers.utils.parseEther('1')
      )

      const aliceBalance = await token.balanceOf(alice.address)
      expect(aliceBalance).to.equal(ethers.utils.parseEther('1'))

      await expect(token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      )).to.be.revertedWith('WeSendit: transactions are paused')
    })
  })

  describe('Staking Pool', function () {
    beforeEach(async function () {
      await token.distributeSaleToken(alice.address, alice.address)

      const MockStakingPool = await ethers.getContractFactory("MockStakingPool");
      mockStakingPool = await MockStakingPool.deploy();

      await token.setStakingPoolAddress(mockStakingPool.address)
    })

    it('Shouldn`t emit event as callback if default (disabled)', async function () {
      await expect(token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      )).to.not
        .emit(mockStakingPool, 'ERC20Received')
    })

    it('Should emit event as callback if enabled', async function () {
      await token.setStakingPoolCallbackEnabled(true)

      await expect(token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      )).to
        .emit(mockStakingPool, 'ERC20Received')
        .withArgs(alice.address, ethers.utils.parseEther('0.015'))
    })

    it('Shouldn`t emit event as callback if disabled', async function () {
      await token.setStakingPoolCallbackEnabled(false)

      await expect(token.connect(alice).transfer(
        bob.address,
        ethers.utils.parseEther('1')
      )).to.not
        .emit(mockStakingPool, 'ERC20Received')
    })
  })
});