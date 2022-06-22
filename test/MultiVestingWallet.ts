const { expect } = require("chai");
const { ethers } = require('hardhat')
const moment = require('moment')

xdescribe("MultiVestingWallet", function () {
  let contract: any;
  let token: any;
  let owner: any;
  let alice: any;
  let bob: any;
  let carlos: any;
  let addrs: any;

  beforeEach(async function () {
    const MultiVestingWallet = await ethers.getContractFactory("MultiVestingWallet");
    [owner, alice, bob, carlos, ...addrs] = await ethers.getSigners();

    contract = await MultiVestingWallet.deploy(0, 60);
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should have not started yet", async function () {
      const started = await contract.isVestingStarted();
      expect(started).to.equal(false);
    });
  });

  describe('Beneficiaries', function () {
    it('should add single beneficiary', async function () {
      await contract.addBeneficiary(alice.address)

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([
        alice.address
      ])
    })

    it('should add multiple beneficiary', async function () {
      await contract.addBeneficiaries([
        alice.address,
        bob.address
      ])

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([
        alice.address,
        bob.address
      ])
    })

    it('should remove single beneficiary', async function () {
      await contract.addBeneficiaries([
        alice.address,
        bob.address
      ])

      await contract.removeBeneficiary(alice.address)

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([
        bob.address
      ])
    })

    it('should remove single beneficiary', async function () {
      await contract.addBeneficiaries([
        alice.address,
        bob.address,
        carlos.address
      ])

      await contract.removeBeneficiary(bob.address)

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([
        alice.address,
        carlos.address
      ])
    })

    it('should remove multiple beneficiary', async function () {
      await contract.addBeneficiaries([
        alice.address,
        bob.address
      ])

      await contract.removeBeneficiary(alice.address)
      await contract.removeBeneficiary(bob.address)

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([])
    })

    it('should remove multiple beneficiary', async function () {
      await contract.addBeneficiaries([
        alice.address,
        bob.address,
        carlos.address
      ])

      await contract.removeBeneficiary(alice.address)
      await contract.removeBeneficiary(bob.address)

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([
        carlos.address
      ])
    })

    it('should remove multiple beneficiary', async function () {
      await contract.addBeneficiaries([
        alice.address,
        bob.address,
        carlos.address
      ])

      await contract.removeBeneficiary(alice.address)
      await contract.removeBeneficiary(carlos.address)

      const beneficiaries = await contract.beneficiaries()
      expect(beneficiaries).to.have.same.members([
        bob.address
      ])
    })
  })

  xdescribe('Vesting (Single Beneficiary)', function () {
    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      token = await MockERC20.deploy();

      await contract.addBeneficiary(alice.address)
      await contract.setStartTimestamp(Math.floor(Date.now() / 1000))
      await token.transfer(contract.address, ethers.utils.parseEther('1'))
    })

    it('should have correct vesting schedule', async function () {
      await new Promise((resolve, reject) => setTimeout(resolve, 10000))

      const vestedAmount = await contract['vestedAmount(address,uint64)'](token.address, Math.floor(Date.now() / 1000))
      expect(vestedAmount).to.be.closeTo(ethers.utils.parseEther(
        (1 / 60 * 10).toString()
      ), ethers.utils.parseUnits('100', 'wei'))
    })

    it('should have correct vesting schedule', async function () {
      await new Promise((resolve, reject) => setTimeout(resolve, 25000))

      const vestedAmount = await contract['vestedAmount(address,uint64)'](token.address, Math.floor(Date.now() / 1000))
      expect(vestedAmount).to.be.closeTo(ethers.utils.parseEther(
        (1 / 60 * 25).toString()
      ), ethers.utils.parseUnits('100', 'wei'))
    })

    it('should have correct vesting schedule', async function () {
      await new Promise((resolve, reject) => setTimeout(resolve, 30000))

      const vestedAmount = await contract['vestedAmount(address,uint64)'](token.address, Math.floor(Date.now() / 1000))
      expect(vestedAmount).to.be.closeTo(ethers.utils.parseEther(
        (1 / 60 * 30).toString()
      ), ethers.utils.parseUnits('100', 'wei'))
    })

    it('should have correct vesting schedule', async function () {
      await new Promise((resolve, reject) => setTimeout(resolve, 60000))

      const vestedAmount = await contract['vestedAmount(address,uint64)'](token.address, Math.floor(Date.now() / 1000))
      expect(vestedAmount).to.equal(ethers.utils.parseEther('1'))
    })
  })

  describe('Vesting (Multiple Beneficiary)', function () {
    let vestingDuration = 120;
    let vestingAmount = 1;
    let beneficiariesCount = 3;
    let startTimestamp: number;

    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      token = await MockERC20.deploy();

      await contract.addBeneficiary(alice.address)
      await contract.addBeneficiary(bob.address)
      await contract.addBeneficiary(carlos.address)

      await contract.setDuration(vestingDuration)
      await token.transfer(contract.address, ethers.utils.parseEther('1'))

      startTimestamp = moment().unix()
      await contract.setStartTimestamp(startTimestamp)
    })

    it('should have correct vesting schedule', async function () {
      const vestingTimeframe = 60 // seconds
      const nextBlockTimestamp = moment.unix(startTimestamp).add(vestingTimeframe, 'seconds').unix()
      const vestedAmount = ethers.utils.parseEther(
        `${(vestingAmount / beneficiariesCount) * (vestingTimeframe / vestingDuration)}`
      )

      await ethers.provider.send("evm_mine", [nextBlockTimestamp]);
      await contract['release(address)'](token.address)

      const balance = await token.balanceOf(alice.address)
      expect(balance).to.be.closeTo(vestedAmount, ethers.utils.parseUnits('100', 'wei'))
    })
  })

});